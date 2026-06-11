/** Tiny fetch+eval stub — drag once, always runs the latest server-side code. */
export function buildStubBookmarklet(ip, port) {
  const url = `http://${ip}:${port}/bookmarklet-code.js`;
  const code = `(function(){fetch('${url}').then(function(r){return r.text()}).then(eval).catch(function(){alert('Sync Along: blocked by this site\\'s Content Security Policy.')})})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

/** Raw minified bookmarklet logic, served at /bookmarklet-code.js. */
export function buildBookmarkletCode(ip, port) {
  const wsURL = `ws://${ip}:${port}`;
  const clientScript = buildClientScript(wsURL);
  return minify(buildBookmarkletSource(wsURL, clientScript));
}

/** The WebSocket client script injected into shared pages. */
export function buildClientScript(wsURL) {
  return minify(buildClientScriptSource(wsURL));
}

function buildClientScriptSource(wsURL) {
  return `(function(){
  if(window.__circleSyncClient)return;
  window.__circleSyncClient=true;
  if(window.__circleSyncClientWS){window.__circleSyncClientWS.close();window.__circleSyncClientWS=null;}
  document.addEventListener('touchmove',function(e){if(e.scale!==undefined&&e.scale!==1)e.preventDefault();},{passive:false});
  document.addEventListener('gesturestart',function(e){e.preventDefault();},{passive:false});
  var CLIENT_COLORS=['#64ffda','#ff6b6b','#ffd93d','#6bcb77','#4d96ff'];
  var ID_KEY='__circleSyncId';
  var lastRatio=-1;
  var ws=null;
  var resizeTimer=null;
  var debugBar=document.createElement('div');
  Object.assign(debugBar.style,{position:'fixed',bottom:'0.5rem',right:'0.5rem',background:'rgba(15,52,96,0.92)',color:'#a8b2d8',borderRadius:'8px',padding:'0.5rem 0.75rem',fontSize:'0.72rem',fontFamily:'system-ui,monospace,sans-serif',zIndex:'2147483647',lineHeight:'1.6',border:'1px solid rgba(100,255,218,0.2)',pointerEvents:'none',visibility:'visible'});
  var debugBadge=document.createElement('span');
  Object.assign(debugBadge.style,{background:'#555',color:'#0a0a1a',padding:'2px 8px',borderRadius:'10px',fontWeight:'bold',fontSize:'0.7rem'});
  debugBadge.textContent='—';
  var debugDims=document.createElement('span');
  Object.assign(debugDims.style,{color:'#6b7db3',display:'block'});
  debugBar.appendChild(debugBadge);
  debugBar.appendChild(debugDims);
  function setIdentity(name,colorIndex){
    debugBadge.textContent=name;
    debugBadge.style.background=CLIENT_COLORS[colorIndex%CLIENT_COLORS.length];
    try{sessionStorage.setItem(ID_KEY,JSON.stringify({name:name,colorIndex:colorIndex}));}catch(e){}
  }
  function updateDebugDims(){
    var vpW=window.innerWidth,vpH=window.innerHeight;
    var scrollY=Math.round(window.scrollY);
    var pageH=document.documentElement.scrollHeight,pageW=document.documentElement.scrollWidth;
    debugDims.textContent='VP '+vpW+'x'+vpH+' Scroll '+scrollY+'px Page '+pageW+'x'+pageH;
  }
  function initDebugBar(){
    document.body.appendChild(debugBar);
    try{
      var saved=JSON.parse(sessionStorage.getItem(ID_KEY)||'null');
      if(saved)setIdentity(saved.name,saved.colorIndex);
    }catch(e){}
    updateDebugDims();
    window.addEventListener('scroll',function(){updateDebugDims();});
  }
  if(document.body){initDebugBar();}
  else{document.addEventListener('DOMContentLoaded',initDebugBar);}
  function sendViewport(){
    if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'viewport',height:window.innerHeight,width:window.innerWidth,scrollY:Math.round(window.scrollY),pageHeight:document.documentElement.scrollHeight,pageWidth:document.documentElement.scrollWidth}));
  }
  window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(sendViewport,300);});
  function connect(){
    ws=new WebSocket('${wsURL}?role=client');
    ws.onopen=function(){sendViewport();};
    ws.onmessage=function(e){
      var m=JSON.parse(e.data);
      if(m.type==='page'){
        lastRatio=-1;
        document.open();
        document.write(m.html);
        document.close();
        window.scrollTo(0,0);
      }else if(m.type==='scroll'){
        if(m.ratio!==lastRatio){
          var down=m.ratio>lastRatio;
          lastRatio=m.ratio;
          var scrollable=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
          var clientRatio=window.scrollY/scrollable;
          if((down&&m.ratio>clientRatio)||(!down&&m.ratio<clientRatio))window.scrollTo(0,m.ratio*scrollable);
        }
        updateDebugDims();
      }else if(m.type==='requestViewport'){
        sendViewport();
      }else if(m.type==='clientInfo'){
        setIdentity(m.name,m.colorIndex);
        updateDebugDims();
      }
    };
    ws.onclose=function(){setTimeout(connect,2000);};
  }
  connect();
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
  var clients={};
  var clientBarsEl=null;
  var masterDebugEl=null;
  var currentRatio=0;
  var CLIENT_COLORS=['#64ffda','#ff6b6b','#ffd93d','#6bcb77','#4d96ff'];
  var savedSel=null;
  var lastElWidth=0;
  try{savedSel=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'{}')[domain]||null;}catch(e){}

  function sendPage(el){
    var origin=location.origin;
    var headHTML=document.head.outerHTML
      .replace(/<base[^>]*>/gi,'')
      .replace(/<meta[^>]*name=["']viewport["'][^>]*>/gi,'');
    var bodyContent=el===document.body?document.body.innerHTML:el.outerHTML;
    var elWidth=el===document.body?0:Math.round(el.getBoundingClientRect().width);
    lastElWidth=elWidth;
    var viewport=elWidth>0?'width='+elWidth+',user-scalable=no':'width=device-width,initial-scale=1,user-scalable=no';
    var html='<!DOCTYPE html><html>'
      +headHTML.replace(/<\\/head>/i,
        '<base href="'+origin+'">'
        +'<meta name="viewport" content="'+viewport+'">'
        +'<style>::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}</style>'
        +'<script>'+${JSON.stringify(clientScript)}+'<\\/script>'
        +'</head>')
      +'<body>'+bodyContent+'</body></html>';
    ws.send(JSON.stringify({type:'page',html:html}));
    // Return the HTML so the caller can pass the exact same string to showMasterView,
    // giving the master an identical rendering to what clients received.
    return html;
  }


  function updateClientBars(){
    if(!clientBarsEl)return;
    clientBarsEl.innerHTML='';
    var iframeVpH=masterOverlay?masterOverlay.contentWindow.innerHeight:window.innerHeight;
    var iframeVpW=masterOverlay?(masterOverlay.contentDocument.documentElement.clientWidth||window.innerWidth):window.innerWidth;
    var vMasterContent=lastElWidth>0?iframeVpH*lastElWidth/iframeVpW:iframeVpH;
    Object.keys(clients).forEach(function(id){
      var c=clients[id];
      var frac=Math.min(1,c.height/vMasterContent);
      var thumbPct=frac*100;
      var thumbTopPct=currentRatio*(100-thumbPct);
      var color=CLIENT_COLORS[(c.colorIndex!==undefined?c.colorIndex:0)%CLIENT_COLORS.length];
      var track=document.createElement('div');
      Object.assign(track.style,{width:'8px',height:'100%',position:'relative',background:'rgba(0,0,0,0.25)',overflow:'hidden',borderRadius:'4px'});
      var thumb=document.createElement('div');
      Object.assign(thumb.style,{position:'absolute',left:'0',width:'100%',height:thumbPct+'%',top:thumbTopPct+'%',background:color,opacity:'0.85',borderRadius:'4px'});
      track.appendChild(thumb);
      clientBarsEl.appendChild(track);
    });
  }

  function createClientBars(){
    if(clientBarsEl)return;
    clientBarsEl=document.createElement('div');
    clientBarsEl.id='__circleSyncBars';
    Object.assign(clientBarsEl.style,{position:'fixed',left:'0',top:'0',height:'100%',display:'flex',flexDirection:'row',alignItems:'stretch',pointerEvents:'none',zIndex:'2147483645',visibility:'visible'});
    document.body.appendChild(clientBarsEl);
    updateClientBars();
  }

  function removeClientBars(){
    if(clientBarsEl){clientBarsEl.remove();clientBarsEl=null;}
  }

  function createMasterDebug(){
    if(masterDebugEl)return;
    masterDebugEl=document.createElement('div');
    masterDebugEl.id='__circleSyncDebug';
    Object.assign(masterDebugEl.style,{position:'fixed',bottom:'0.5rem',right:'0.5rem',background:'rgba(15,52,96,0.92)',color:'#a8b2d8',borderRadius:'8px',padding:'0.5rem 0.75rem',fontFamily:'system-ui,sans-serif',fontSize:'0.72rem',zIndex:'2147483645',pointerEvents:'none',lineHeight:'1.6',maxWidth:'240px',visibility:'visible',border:'1px solid rgba(100,255,218,0.2)'});
    document.body.appendChild(masterDebugEl);
    updateMasterDebug();
  }

  function removeMasterDebug(){
    if(masterDebugEl){masterDebugEl.remove();masterDebugEl=null;}
  }

  function updateMasterDebug(){
    if(!masterDebugEl)return;
    var scrollTop=masterOverlay?masterOverlay.contentWindow.scrollY:window.scrollY;
    var scrollH=masterOverlay?masterOverlay.contentDocument.documentElement.scrollHeight:document.documentElement.scrollHeight;
    var vpH=masterOverlay?masterOverlay.contentWindow.innerHeight:window.innerHeight;
    var vpW=masterOverlay?(masterOverlay.contentDocument.documentElement.clientWidth||window.innerWidth):window.innerWidth;
    var scrollW=masterOverlay?masterOverlay.contentDocument.documentElement.scrollWidth:document.documentElement.scrollWidth;
    var ids=Object.keys(clients);
    var html='<div style="color:#64ffda;font-weight:bold;margin-bottom:2px">'+ids.length+' client'+(ids.length!==1?'s':'')+'</div>';
    ids.forEach(function(id){
      var c=clients[id];
      var color=CLIENT_COLORS[(c.colorIndex!==undefined?c.colorIndex:0)%CLIENT_COLORS.length];
      html+='<div><span style="color:'+color+'">&#9679;</span> '+(c.name||'Client '+id);
      if(c.width&&c.height)html+=' <span style="color:#6b7db3">'+c.width+'&#215;'+c.height+'</span>';
      html+='</div>';
    });
    html+='<div style="margin-top:4px;border-top:1px solid rgba(168,178,216,0.2);padding-top:4px">';
    html+='<span style="color:#e94560">Master</span> '+vpW+'&#215;'+vpH;
    html+='<br>Scroll '+Math.round(scrollTop)+'px &nbsp;Page '+scrollW+'&#215;'+scrollH;
    html+='</div>';
    masterDebugEl.innerHTML=html;
  }

  function sendScroll(){
    if(ws.readyState!==ws.OPEN)return;
    // When the master view iframe is open, read scroll from its inner document so
    // the ratio is relative to the same layout clients are viewing.
    var scrollTop=masterOverlay?masterOverlay.contentWindow.scrollY:window.scrollY;
    var scrollHeight=masterOverlay?masterOverlay.contentDocument.documentElement.scrollHeight:document.documentElement.scrollHeight;
    var viewportHeight=masterOverlay?masterOverlay.contentWindow.innerHeight:window.innerHeight;
    currentRatio=scrollTop/Math.max(1,scrollHeight-viewportHeight);
    ws.send(JSON.stringify({type:'scroll',ratio:currentRatio}));
    updateClientBars();
    updateMasterDebug();
  }

  function lockScroll(){
    document.documentElement.style.overflow='hidden';
    document.body.style.overflow='hidden';
    document.body.style.visibility='hidden';
  }

  function unlockScroll(){
    document.documentElement.style.overflow='';
    document.body.style.overflow='';
    document.body.style.visibility='';
  }

  function showMasterView(html){
    if(masterOverlay){masterOverlay.remove();masterOverlay=null;}
    if(masterCloseBtn){masterCloseBtn.remove();masterCloseBtn=null;}
    var iframe=document.createElement('iframe');
    iframe.id='__circleSyncView';
    iframe.srcdoc=html.replace(/(<html[^>]*>)/i,'$1<script>window.__circleSyncClient=true;<\\/script>');
    if(lastElWidth>0){
      iframe.addEventListener('load',function(){
        var W=lastElWidth;
        var b=iframe.contentDocument.body;
        b.style.margin='0';
        b.style.width=W+'px';
        b.style.zoom=iframe.contentDocument.documentElement.clientWidth/W;
      });
    }
    Object.assign(iframe.style,{
      position:'fixed',top:0,left:0,width:'100%',height:'100%',
      border:'none',zIndex:2147483644,visibility:'visible'
    });
    var closeBtn=document.createElement('button');
    closeBtn.textContent='✕';
    closeBtn.id='__circleSyncCloseBtn';
    Object.assign(closeBtn.style,{
      position:'fixed',top:'0.4rem',right:'1.25rem',
      background:'#e94560',color:'white',border:'none',
      width:'2.25rem',height:'2.25rem',borderRadius:'50%',
      fontSize:'1rem',cursor:'pointer',zIndex:2147483646,
      fontFamily:'system-ui,sans-serif',lineHeight:'2.25rem',textAlign:'center',
      visibility:'visible'
    });
    closeBtn.addEventListener('click',function(){
      if(masterOverlay){masterOverlay.remove();masterOverlay=null;}
      closeBtn.remove();masterCloseBtn=null;
      if(scrollTimer){clearInterval(scrollTimer);scrollTimer=null;}
      unlockScroll();
      removeClientBars();
      removeMasterDebug();
    });
    document.body.appendChild(iframe);
    document.body.appendChild(closeBtn);
    masterOverlay=iframe;
    masterCloseBtn=closeBtn;
    lockScroll();
    createClientBars();
    createMasterDebug();
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
      if(ws.readyState===ws.OPEN){var h=sendPage(document.body);showMasterView(h);installScroll();}
      else ws.addEventListener('open',function once(){ws.removeEventListener('open',once);var h=sendPage(document.body);showMasterView(h);installScroll();});
    });

    document.body.appendChild(pickOverlay);
    document.body.appendChild(hint);
    document.body.appendChild(shareBtn);
    shareBtn.focus();

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
      if(ws.readyState===ws.OPEN){var h=sendPage(el);showMasterView(h);installScroll();}
      else ws.addEventListener('open',function once(){ws.removeEventListener('open',once);var h=sendPage(el);showMasterView(h);installScroll();});
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
    unlockScroll();
    removeClientBars();
    removeMasterDebug();
    window.__circleSyncCleanup=null;
  }
  window.__circleSyncCleanup=cleanup;

  ws.onmessage=function(e){
    var m=JSON.parse(e.data);
    if(m.type==='viewport'){
      clients[m.clientId]={height:m.height,width:m.width,scrollY:m.scrollY,pageHeight:m.pageHeight,pageWidth:m.pageWidth,name:m.name,colorIndex:m.colorIndex};
      updateClientBars();
      updateMasterDebug();
    }else if(m.type==='clientLeft'){
      delete clients[m.clientId];
      updateClientBars();
      updateMasterDebug();
    }else if(m.type==='clientJoined'){
      if(!clients[m.clientId])clients[m.clientId]={height:0};
      clients[m.clientId].name=m.name;
      clients[m.clientId].colorIndex=m.colorIndex;
      updateMasterDebug();
    }
  };
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
    useBtn.focus();

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
    .split('\n')
    .map(line => line.replace(/(?<!:)\/\/.*$/, ''))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
