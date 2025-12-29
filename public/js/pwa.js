(function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  let deferredPrompt;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  if (isStandalone) return;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    setTimeout(showInstallBanner, 2000);
  });

  if (isIOS && !localStorage.getItem('pwa-never') && !isDelayed()) {
    setTimeout(showIOSGuide, 3000);
  }

  function isDelayed() {
    const delayed = localStorage.getItem('pwa-delayed');
    if (!delayed) return false;
    return Date.now() < parseInt(delayed, 10);
  }

  function showInstallBanner() {
    if (localStorage.getItem('pwa-never')) return;
    if (isDelayed()) return;
    
    const banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.className = 'pwa-banner';
    banner.innerHTML = `
      <style>
        .pwa-banner {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9999;
          animation: pwa-slide-up 0.3s ease;
          overflow: visible;
        }
        .pwa-banner-inner {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 20px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          font-size: 14px;
          color: #374151;
          position: relative;
        }
        .dark .pwa-banner-inner {
          background: #1f2937;
          border-color: #374151;
          color: #e5e7eb;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .pwa-banner-text {
          font-weight: 400;
        }
        .pwa-banner-actions {
          display: flex;
          gap: 8px;
        }
        .pwa-btn-install {
          padding: 8px 20px;
          background: #111827;
          color: #fff;
          border: none;
          font-size: 13px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .pwa-btn-install:hover {
          background: #374151;
        }
        .dark .pwa-btn-install {
          background: #f3f4f6;
          color: #111827;
        }
        .dark .pwa-btn-install:hover {
          background: #e5e7eb;
        }
        .pwa-btn-later {
          padding: 8px 12px;
          background: transparent;
          color: #9ca3af;
          border: 1px solid #e5e7eb;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .pwa-btn-later:hover {
          color: #374151;
          border-color: #9ca3af;
        }
        .dark .pwa-btn-later {
          border-color: #4b5563;
          color: #9ca3af;
        }
        .dark .pwa-btn-later:hover {
          color: #e5e7eb;
          border-color: #6b7280;
        }
        .pwa-btn-never {
          position: absolute;
          top: -8px;
          right: -8px;
          width: 24px;
          height: 24px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 50%;
          color: #9ca3af;
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          padding: 0;
          line-height: 1;
        }
        .pwa-btn-never:hover {
          color: #374151;
          border-color: #9ca3af;
        }
        .dark .pwa-btn-never {
          background: #374151;
          border-color: #4b5563;
          color: #9ca3af;
        }
        .dark .pwa-btn-never:hover {
          color: #e5e7eb;
          border-color: #6b7280;
        }
        @keyframes pwa-slide-up {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @media (max-width: 640px) {
          .pwa-banner {
            left: 16px;
            right: 16px;
            transform: none;
          }
          @keyframes pwa-slide-up {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .pwa-banner-inner {
            flex-direction: column;
            gap: 12px;
            text-align: center;
          }
          .pwa-banner-actions {
            width: 100%;
          }
          .pwa-btn-install, .pwa-btn-later {
            flex: 1;
          }
        }
      </style>
      <div class="pwa-banner-inner">
        <button class="pwa-btn-never" id="pwa-never" title="不再提示">×</button>
        <span class="pwa-banner-text">添加到主屏幕，获得更好体验</span>
        <div class="pwa-banner-actions">
          <button class="pwa-btn-install" id="pwa-install">添加</button>
          <button class="pwa-btn-later" id="pwa-later">稍后</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install').onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      }
      banner.remove();
    };

    document.getElementById('pwa-later').onclick = () => {
      localStorage.setItem('pwa-delayed', Date.now() + 7 * 24 * 60 * 60 * 1000);
      banner.remove();
    };

    document.getElementById('pwa-never').onclick = () => {
      localStorage.setItem('pwa-never', '1');
      banner.remove();
    };
  }

  function showIOSGuide() {
    const guide = document.createElement('div');
    guide.id = 'pwa-ios-guide';
    guide.className = 'pwa-banner';
    guide.innerHTML = `
      <style>
        .pwa-ios-inner {
          padding: 20px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
          max-width: 320px;
          position: relative;
        }
        .dark .pwa-ios-inner {
          background: #1f2937;
          border-color: #374151;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .pwa-ios-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .pwa-ios-title {
          font-size: 14px;
          font-weight: 500;
          color: #111827;
        }
        .dark .pwa-ios-title {
          color: #f3f4f6;
        }
        .pwa-ios-text {
          font-size: 13px;
          color: #6b7280;
          line-height: 1.6;
          margin-bottom: 16px;
        }
        .dark .pwa-ios-text {
          color: #9ca3af;
        }
        .pwa-ios-icon {
          display: inline-block;
          width: 18px;
          height: 18px;
          vertical-align: middle;
          margin: 0 2px;
        }
        .pwa-ios-actions {
          display: flex;
          gap: 8px;
        }
        .pwa-ios-btn {
          flex: 1;
          padding: 8px 12px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .pwa-ios-btn-later {
          background: transparent;
          color: #9ca3af;
          border: 1px solid #e5e7eb;
        }
        .pwa-ios-btn-later:hover {
          color: #374151;
          border-color: #9ca3af;
        }
        .dark .pwa-ios-btn-later {
          border-color: #4b5563;
        }
        .dark .pwa-ios-btn-later:hover {
          color: #e5e7eb;
          border-color: #6b7280;
        }
        .pwa-ios-btn-never {
          background: transparent;
          color: #9ca3af;
          border: 1px solid #e5e7eb;
        }
        .pwa-ios-btn-never:hover {
          color: #ef4444;
          border-color: #ef4444;
        }
        .dark .pwa-ios-btn-never {
          border-color: #4b5563;
        }
        .dark .pwa-ios-btn-never:hover {
          color: #f87171;
          border-color: #f87171;
        }
      </style>
      <div class="pwa-ios-inner">
        <div class="pwa-ios-header">
          <span class="pwa-ios-title">添加到主屏幕</span>
        </div>
        <div class="pwa-ios-text">
          点击底部 <svg class="pwa-ios-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 3h-2v6h-2V5H9l3-3zm-7 9v10h14V11h2v12H3V11h2z"/></svg> 分享按钮，选择「添加到主屏幕」
        </div>
        <div class="pwa-ios-actions">
          <button class="pwa-ios-btn pwa-ios-btn-later" id="pwa-ios-later">稍后</button>
          <button class="pwa-ios-btn pwa-ios-btn-never" id="pwa-ios-never">不再提示</button>
        </div>
      </div>
    `;
    document.body.appendChild(guide);

    document.getElementById('pwa-ios-later').onclick = () => {
      localStorage.setItem('pwa-delayed', Date.now() + 7 * 24 * 60 * 60 * 1000);
      guide.remove();
    };

    document.getElementById('pwa-ios-never').onclick = () => {
      localStorage.setItem('pwa-never', '1');
      guide.remove();
    };
  }
})();