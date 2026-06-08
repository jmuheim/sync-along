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
  return `(function(){if(window.__circleSyncClient)return;window.__circleSyncClient=true;var lastRatio=-1;function connect(){var ws=new WebSocket('${wsURL}?role=client');ws.onmessage=function(e){var m=JSON.parse(e.data);if(m.type==='page'){document.open();document.write(m.html);document.close();}else if(m.type==='scroll'){if(m.ratio!==lastRatio){var down=m.ratio>lastRatio;lastRatio=m.ratio;var clientRatio=window.scrollY/Math.max(1,document.documentElement.scrollHeight);if((down&&m.ratio>clientRatio)||(!down&&m.ratio<clientRatio))window.scrollTo(0,m.ratio*document.documentElement.scrollHeight);}}};ws.onclose=function(){setTimeout(connect,2000);};}connect();})();`;
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
  }

  function sendScroll(){
    if(ws.readyState!==ws.OPEN)return;
    var scrollTop=masterOverlay?masterOverlay.scrollTop:window.scrollY;
    var scrollHeight=masterOverlay?masterOverlay.scrollHeight:document.documentElement.scrollHeight;
    ws.send(JSON.stringify({type:'scroll',ratio:scrollTop/Math.max(1,scrollHeight)}));
  }

  function showMasterView(el){
    if(masterOverlay){masterOverlay.remove();masterOverlay=null;}
    if(masterCloseBtn){masterCloseBtn.remove();masterCloseBtn=null;}
    var bg=window.getComputedStyle(document.body).backgroundColor;
    if(!bg||bg==='rgba(0, 0, 0, 0)'||bg==='transparent')bg='#fff';
    var overlay=document.createElement('div');
    overlay.id='__circleSyncView';
    Object.assign(overlay.style,{
      position:'fixed',top:0,left:0,right:0,bottom:0,
      background:bg,zIndex:2147483644,overflowY:'auto',
      boxSizing:'border-box'
    });
    var inner=document.createElement('div');
    inner.innerHTML=el.outerHTML;
    overlay.appendChild(inner);
    var closeBtn=document.createElement('button');
    closeBtn.textContent='✕';
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
      var s=document.getElementById('__circleSyncStyle');if(s)s.remove();
      if(scrollTimer){clearInterval(scrollTimer);scrollTimer=null;}
    });
    closeBtn.id='__circleSyncCloseBtn';
    var styleTag=document.createElement('style');
    styleTag.id='__circleSyncStyle';
    styleTag.textContent='body>*:not(#__circleSyncView):not(#__circleSyncCloseBtn){display:none!important}';
    document.head.appendChild(styleTag);
    document.body.appendChild(overlay);
    document.body.appendChild(closeBtn);
    masterOverlay=overlay;
    masterCloseBtn=closeBtn;
  }

  function saveSel(el){
    var sel=getCSSPath(el);
    var store={};
    try{store=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'{}');}catch(e){}
    store[domain]=sel;
    sessionStorage.setItem(STORAGE_KEY,JSON.stringify(store));
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
      ws.addEventListener('open',function once(){ws.removeEventListener('open',once);sendPage(document.body);installScroll();});
      if(ws.readyState===ws.OPEN){sendPage(document.body);installScroll();}
    });

    document.body.appendChild(pickOverlay);
    document.body.appendChild(hint);
    document.body.appendChild(shareBtn);

    var hints=[pickOverlay,hint];

    function onMove(e){
      var x=e.clientX!==undefined?e.clientX:(e.touches&&e.touches[0]?e.touches[0].clientX:null);
      var y=e.clientY!==undefined?e.clientY:(e.touches&&e.touches[0]?e.touches[0].clientY:null);
      if(x===null)return;
      var el=document.elementFromPoint(x,y);
      if(el===pickOverlay||el===hint||el===shareBtn)return;
      if(highlighted&&highlighted!==el)highlighted.style.outline='';
      if(el){el.style.outline='3px solid #e94560';highlighted=el;}
    }

    function onPick(e){
      var x=e.clientX!==undefined?e.clientX:(e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientX:null);
      var y=e.clientY!==undefined?e.clientY:(e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientY:null);
      var el=document.elementFromPoint(x,y);
      if(!el||el===pickOverlay||el===hint||el===shareBtn)return;
      e.preventDefault();e.stopPropagation();
      el.style.outline='';
      if(pickOverlay&&pickOverlay.__cleanup)pickOverlay.__cleanup();
      saveSel(el);
      if(ws.readyState===ws.OPEN){sendPage(el);showMasterView(el);installScroll();}
      else ws.addEventListener('open',function once(){ws.removeEventListener('open',once);sendPage(el);showMasterView(el);installScroll();});
    }

    document.addEventListener('mousemove',onMove,true);
    document.addEventListener('touchmove',onMove,{capture:true,passive:true});
    document.addEventListener('click',onPick,true);
    document.addEventListener('touchend',onPick,{capture:true});

    function onMouseDown(e){e.preventDefault();}
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
    var s=document.getElementById('__circleSyncStyle');if(s)s.remove();
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
      sendPage(el);
      showMasterView(el);
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
