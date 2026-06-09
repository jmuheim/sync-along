/**
 * Builds the bookmarklet javascript: URL.
 * The bookmarklet code is kept as a plain function and minified via
 * string transformation so we can test the logic separately.
 */

export function buildBookmarklet(ip, port) {
  const wsURL = `ws://${ip}:${port}`;
  const clientScript = buildClientScript(wsURL);
  const code = buildBookmarkletSource(wsURL, clientScript);
  return `javascript:${encodeURIComponent(minify(code))}`;
}

/** The WebSocket client script injected into shared pages. */
export function buildClientScript(wsURL) {
  return `(function(){
if(window.__circleSyncClient)return;
window.__circleSyncClient=true;
var lastRatio=-1,ws=null;

// Inject a small "Propose URL" button so clients can suggest a URL to master
// even after document.write has replaced the page. Called on first load and
// again after every page replacement (the old DOM is gone each time).
function injectUI(){
  if(document.getElementById('__csp'))return;
  var btn=document.createElement('button');
  btn.id='__csp';btn.textContent='+ URL';
  Object.assign(btn.style,{position:'fixed',bottom:'1rem',left:'1rem',background:'#0f3460',color:'#a8b2d8',border:'1px solid #a8b2d8',padding:'0.3rem 0.7rem',borderRadius:'6px',cursor:'pointer',fontFamily:'system-ui,sans-serif',fontSize:'0.8rem',zIndex:2147483646});
  var form=document.createElement('div');
  Object.assign(form.style,{display:'none',position:'fixed',bottom:'3.5rem',left:'1rem',background:'#16213e',padding:'0.5rem',borderRadius:'8px',gap:'0.5rem',zIndex:2147483646,boxShadow:'0 4px 20px rgba(0,0,0,0.5)'});
  var inp=document.createElement('input');
  inp.type='url';inp.placeholder='https://...';
  Object.assign(inp.style,{background:'#1a1a2e',color:'#eee',border:'1px solid #a8b2d8',padding:'0.3rem 0.5rem',borderRadius:'4px',fontFamily:'system-ui,sans-serif',fontSize:'0.9rem',width:'220px'});
  var sub=document.createElement('button');
  sub.textContent='Propose';
  Object.assign(sub.style,{background:'#64ffda',color:'#0f3460',border:'none',padding:'0.3rem 0.7rem',borderRadius:'4px',cursor:'pointer',fontFamily:'system-ui,sans-serif',fontWeight:'bold'});
  form.appendChild(inp);form.appendChild(sub);
  document.body.appendChild(btn);document.body.appendChild(form);
  btn.addEventListener('click',function(){var open=form.style.display==='flex';form.style.display=open?'none':'flex';if(!open)inp.focus();});
  function send(){var u=inp.value.trim();if(!u)return;if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'propose',url:u}));inp.value='';form.style.display='none';btn.textContent='Proposed!';setTimeout(function(){btn.textContent='+ URL';},2000);}
  sub.addEventListener('click',send);
  inp.addEventListener('keydown',function(e){if(e.key==='Enter')send();});
}

function connect(){
  ws=new WebSocket('${wsURL}?role=client');
  ws.onmessage=function(e){
    var m=JSON.parse(e.data);
    if(m.type==='page'){
      lastRatio=-1;document.open();document.write(m.html);document.close();window.scrollTo(0,0);
      injectUI(); // re-inject after document.write destroys the previous button
    }else if(m.type==='scroll'){
      if(m.ratio!==lastRatio){var down=m.ratio>lastRatio;lastRatio=m.ratio;var clientRatio=window.scrollY/Math.max(1,document.documentElement.scrollHeight);if((down&&m.ratio>clientRatio)||(!down&&m.ratio<clientRatio))window.scrollTo(0,m.ratio*document.documentElement.scrollHeight);}
    }else if(m.type==='navigate'){
      window.location.href=m.url;
    }
  };
  ws.onclose=function(){setTimeout(connect,2000);};
}
connect();injectUI();
})();`;
}

/** The full bookmarklet source (runs on master's browser). */
export function buildBookmarkletSource(wsURL, clientScript) {
  return `(function(){
  var STORAGE_KEY='__circleSyncSel';
  var domain=location.hostname;
  if(window.__circleSyncCleanup)window.__circleSyncCleanup();

  var ws=new WebSocket('${wsURL}?role=master');
  var scrollTimer=null;
  var pickOverlay=null;
  var highlighted=null;
  var masterOverlay=null;
  var masterCloseBtn=null;
  var savedSel=null;
  try{savedSel=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'{}')[domain]||null;}catch(e){}

  function sendPage(el){
    var origin=location.origin;
    var headHTML=document.head.outerHTML
      .replace(/<base[^>]*>/gi,'');
    var bodyContent=el===document.body?document.body.innerHTML:el.outerHTML;
    var html='<!DOCTYPE html><html>'
      +headHTML.replace(/<\\/head>/i,
        '<base href="'+origin+'">'
        +'<meta name="viewport" content="width=device-width,initial-scale=1">'
        +'<script>'+${JSON.stringify(clientScript)}+'<\\/script>'
        +'</head>')
      +'<body>'+bodyContent+'</body></html>';
    ws.send(JSON.stringify({type:'page',html:html}));
    // Return the HTML so the caller can pass the exact same string to showMasterView,
    // giving the master an identical rendering to what clients received.
    return html;
  }

  function sendScroll(){
    if(ws.readyState!==ws.OPEN)return;
    // When the master view iframe is open, read scroll from its inner document so
    // the ratio is relative to the same layout clients are viewing.
    var scrollTop=masterOverlay?masterOverlay.contentWindow.scrollY:window.scrollY;
    var scrollHeight=masterOverlay?masterOverlay.contentDocument.documentElement.scrollHeight:document.documentElement.scrollHeight;
    ws.send(JSON.stringify({type:'scroll',ratio:scrollTop/Math.max(1,scrollHeight)}));
  }

  function showMasterView(html){
    if(masterOverlay){masterOverlay.remove();masterOverlay=null;}
    if(masterCloseBtn){masterCloseBtn.remove();masterCloseBtn=null;}
    // Render the master view in an iframe using the exact HTML string that was sent
    // to clients. This guarantees the master sees the same document — same styles,
    // same base URL resolution, same layout — rather than a raw outerHTML clone
    // rendered inside the original page's CSS context.
    var iframe=document.createElement('iframe');
    iframe.id='__circleSyncView';
    iframe.srcdoc=html;
    Object.assign(iframe.style,{
      position:'fixed',top:0,left:0,width:'100%',height:'100%',
      border:'none',zIndex:2147483644
    });
    var closeBtn=document.createElement('button');
    closeBtn.textContent='✕';
    closeBtn.id='__circleSyncCloseBtn';
    Object.assign(closeBtn.style,{
      position:'fixed',top:'0.4rem',right:'1.25rem',
      background:'#e94560',color:'white',border:'none',
      width:'2.25rem',height:'2.25rem',borderRadius:'50%',
      fontSize:'1rem',cursor:'pointer',zIndex:2147483645,
      fontFamily:'system-ui,sans-serif',lineHeight:'2.25rem',textAlign:'center'
    });
    closeBtn.addEventListener('click',function(){
      if(masterOverlay){masterOverlay.remove();masterOverlay=null;}
      closeBtn.remove();masterCloseBtn=null;
      if(scrollTimer){clearInterval(scrollTimer);scrollTimer=null;}
    });
    document.body.appendChild(iframe);
    document.body.appendChild(closeBtn);
    masterOverlay=iframe;
    masterCloseBtn=closeBtn;
  }

  function saveSel(el){
    try{
      var sel=getCSSPath(el);
      var store={};
      try{store=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'{}');}catch(e){}
      store[domain]=sel;
      sessionStorage.setItem(STORAGE_KEY,JSON.stringify(store));
    }catch(e){}
  }

  function getCSSPath(el){
    var parts=[];
    while(el&&el!==document.body){
      var tag=el.tagName.toLowerCase();
      var cls=Array.from(el.classList).slice(0,2).join('.');
      parts.unshift(tag+(cls?'.'+cls:''));
      el=el.parentElement;
    }
    return parts.join('>');
  }

  function removeOverlay(){
    if(pickOverlay){pickOverlay.remove();pickOverlay=null;}
    if(highlighted){highlighted.style.outline='';highlighted=null;}
  }

  function startPickMode(){
    pickOverlay=document.createElement('div');
    pickOverlay.id='__circleSyncOverlay';
    Object.assign(pickOverlay.style,{
      position:'fixed',top:0,left:0,right:0,bottom:0,
      background:'rgba(0,0,0,0.45)',zIndex:2147483646,
      pointerEvents:'none'
    });

    var hint=document.createElement('div');
    Object.assign(hint.style,{
      position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
      background:'#e94560',color:'white',padding:'1rem 1.5rem',borderRadius:'12px',
      fontFamily:'system-ui,sans-serif',fontSize:'1.1rem',zIndex:2147483647,
      pointerEvents:'none',textAlign:'center',whiteSpace:'nowrap'
    });
    hint.textContent='Tap the lyrics container';

    var shareBtn=document.createElement('button');
    Object.assign(shareBtn.style,{
      position:'fixed',bottom:'2rem',right:'2rem',
      background:'#0f3460',color:'white',border:'none',
      padding:'0.75rem 1.25rem',borderRadius:'8px',cursor:'pointer',
      fontFamily:'system-ui,sans-serif',fontSize:'1rem',zIndex:2147483647
    });
    shareBtn.textContent='Share whole page';
    shareBtn.addEventListener('click',function(e){
      e.stopPropagation();
      hints.forEach(function(h){if(h.parentNode)h.remove();});
      if(shareBtn.parentNode)shareBtn.remove();
      removeOverlay();
      ws.addEventListener('open',function once(){ws.removeEventListener('open',once);var h=sendPage(document.body);showMasterView(h);installScroll();});
      if(ws.readyState===ws.OPEN){var h=sendPage(document.body);showMasterView(h);installScroll();}
    });

    document.body.appendChild(pickOverlay);
    document.body.appendChild(hint);
    document.body.appendChild(shareBtn);

    var hints=[pickOverlay,hint];

    // Returns true if el is part of a circle-sync UI element that should handle
    // its own events (proposal dialogs, the master view iframe, close button).
    function isCircleSyncUI(el){
      return !el||el===pickOverlay||el===hint||el===shareBtn
        ||(el.closest&&(el.closest('.__circleSyncProposal')||el.id==='__circleSyncView'||el.id==='__circleSyncCloseBtn'));
    }

    function onMove(e){
      var x=e.clientX!==undefined?e.clientX:(e.touches&&e.touches[0]?e.touches[0].clientX:null);
      var y=e.clientY!==undefined?e.clientY:(e.touches&&e.touches[0]?e.touches[0].clientY:null);
      if(x===null)return;
      var el=document.elementFromPoint(x,y);
      if(isCircleSyncUI(el))return;
      if(highlighted&&highlighted!==el)highlighted.style.outline='';
      if(el){el.style.outline='3px solid #e94560';highlighted=el;}
    }

    function onPick(e){
      var x=e.clientX!==undefined?e.clientX:(e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientX:null);
      var y=e.clientY!==undefined?e.clientY:(e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientY:null);
      var el=document.elementFromPoint(x,y);
      // Let clicks on circle-sync UI (proposal dialogs etc.) pass through untouched
      if(isCircleSyncUI(el))return;
      e.preventDefault();e.stopPropagation();
      el.style.outline='';
      if(pickOverlay&&pickOverlay.__cleanup)pickOverlay.__cleanup();
      saveSel(el);
      if(ws.readyState===ws.OPEN){var h=sendPage(el);showMasterView(h);installScroll();}
      else ws.addEventListener('open',function once(){ws.removeEventListener('open',once);var h=sendPage(el);showMasterView(h);installScroll();});
    }

    document.addEventListener('mousemove',onMove,true);
    document.addEventListener('touchmove',onMove,{capture:true,passive:true});
    document.addEventListener('click',onPick,true);
    document.addEventListener('touchend',onPick,{capture:true});

    // Suppress mousedown during pick mode to prevent text selection, but let
    // circle-sync UI elements receive their own mousedown events normally.
    function onMouseDown(e){if(!isCircleSyncUI(document.elementFromPoint(e.clientX,e.clientY)))e.preventDefault();}
    document.addEventListener('mousedown',onMouseDown,true);

    pickOverlay.__cleanup=function(){
      document.removeEventListener('mousemove',onMove,true);
      document.removeEventListener('touchmove',onMove,true);
      document.removeEventListener('click',onPick,true);
      document.removeEventListener('touchend',onPick,true);
      document.removeEventListener('mousedown',onMouseDown,true);
      hints.forEach(function(h){if(h.parentNode)h.remove();});
      if(shareBtn.parentNode)shareBtn.remove();
      removeOverlay();
    };
  }

  function installScroll(){
    if(scrollTimer)clearInterval(scrollTimer);
    scrollTimer=setInterval(sendScroll,200);
  }

  function cleanup(){
    if(ws){ws.close();ws=null;}
    if(scrollTimer){clearInterval(scrollTimer);scrollTimer=null;}
    if(pickOverlay&&pickOverlay.__cleanup)pickOverlay.__cleanup();
    if(masterOverlay){masterOverlay.remove();masterOverlay=null;}
    if(masterCloseBtn){masterCloseBtn.remove();masterCloseBtn=null;}
    document.querySelectorAll('.__circleSyncProposal').forEach(function(d){d.remove();});
    window.__circleSyncCleanup=null;
  }
  window.__circleSyncCleanup=cleanup;

  ws.onopen=function(){
    if(savedSel){
      var el=document.querySelector(savedSel);
      if(el){
        showSavedPrompt(el);
        return;
      }
    }
    startPickMode();
  };
  ws.onerror=function(){startPickMode();};

  // Receive URL proposals from clients and present a confirmation dialog
  ws.onmessage=function(e){
    try{var m=JSON.parse(e.data);if(m.type==='propose')showProposalDialog(m.url);}catch(err){}
  };

  function showProposalDialog(url){
    // Modal overlay so the master can clearly read the URL before deciding
    var overlay=document.createElement('div');
    overlay.className='__circleSyncProposal';
    Object.assign(overlay.style,{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.55)',zIndex:2147483646,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui,sans-serif'});
    var box=document.createElement('div');
    Object.assign(box.style,{background:'#16213e',color:'#eee',padding:'1.5rem 2rem',borderRadius:'12px',maxWidth:'480px',width:'90%',boxShadow:'0 8px 40px rgba(0,0,0,0.6)',display:'flex',flexDirection:'column',gap:'1rem'});
    var label=document.createElement('p');
    label.textContent='Client proposes a URL:';
    label.style.cssText='margin:0;color:#a8b2d8;font-size:0.9rem;text-transform:uppercase;letter-spacing:1px';
    var link=document.createElement('a');
    link.href=url;link.target='_blank';link.textContent=url;
    link.style.cssText='color:#64ffda;word-break:break-all;font-size:0.95rem';
    var btns=document.createElement('div');
    btns.style.cssText='display:flex;gap:0.75rem;justify-content:flex-end;margin-top:0.5rem';
    var dismissBtn=document.createElement('button');
    dismissBtn.textContent='Dismiss';
    Object.assign(dismissBtn.style,{background:'transparent',color:'#a8b2d8',border:'1px solid #a8b2d8',padding:'0.5rem 1rem',borderRadius:'6px',cursor:'pointer',fontFamily:'system-ui,sans-serif'});
    var shareBtn=document.createElement('button');
    shareBtn.textContent='Share with clients';
    Object.assign(shareBtn.style,{background:'#64ffda',color:'#0f3460',border:'none',padding:'0.5rem 1rem',borderRadius:'6px',cursor:'pointer',fontWeight:'bold',fontFamily:'system-ui,sans-serif'});
    btns.appendChild(dismissBtn);btns.appendChild(shareBtn);
    box.appendChild(label);box.appendChild(link);box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    // Share with clients: broadcast navigate so every client navigates to the URL
    shareBtn.addEventListener('click',function(){if(ws&&ws.readyState===ws.OPEN)ws.send(JSON.stringify({type:'navigate',url:url}));overlay.remove();});
    dismissBtn.addEventListener('click',function(){overlay.remove();});
  }

  function showSavedPrompt(el){
    el.style.outline='3px solid #64ffda';
    var bar=document.createElement('div');
    Object.assign(bar.style,{
      position:'fixed',top:'1rem',left:'50%',transform:'translateX(-50%)',
      background:'#0f3460',color:'white',padding:'0.75rem 1.25rem',
      borderRadius:'10px',zIndex:2147483647,fontFamily:'system-ui,sans-serif',
      fontSize:'0.95rem',display:'flex',gap:'0.75rem',alignItems:'center',
      boxShadow:'0 4px 20px rgba(0,0,0,0.5)'
    });
    bar.innerHTML='Using saved element &nbsp;';
    var useBtn=document.createElement('button');
    useBtn.textContent='Use it';
    Object.assign(useBtn.style,{background:'#64ffda',color:'#0f3460',border:'none',padding:'0.4rem 0.8rem',borderRadius:'6px',cursor:'pointer',fontWeight:'bold'});
    var changeBtn=document.createElement('button');
    changeBtn.textContent='Change?';
    Object.assign(changeBtn.style,{background:'transparent',color:'#a8b2d8',border:'1px solid #a8b2d8',padding:'0.4rem 0.8rem',borderRadius:'6px',cursor:'pointer'});
    bar.appendChild(useBtn);bar.appendChild(changeBtn);
    document.body.appendChild(bar);

    useBtn.addEventListener('click',function(){
      el.style.outline='';
      bar.remove();
      var h=sendPage(el);
      showMasterView(h);
      installScroll();
    });
    changeBtn.addEventListener('click',function(){
      el.style.outline='';
      bar.remove();
      startPickMode();
    });
  }
})();`;
}

function minify(code) {
  return code
    .replace(/\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
