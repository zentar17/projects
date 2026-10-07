(function () {
    var header = document.querySelector('body > header');
    if (!header) return;
    var auth = header.querySelector('.header-auth');
    var nav = header.querySelector('.header-nav');
    var authBtn = document.getElementById('authBtn');
    if (!auth || !nav) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-menu-btn';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    auth.appendChild(btn);

    var logout = null;
    if (authBtn) {
        logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'mobile-auth-item';
        nav.appendChild(logout);
        logout.addEventListener('click', function () {
            authBtn.click();
        });
    }

    function sync() {
        if (!authBtn || !logout) return;
        var logged = authBtn.classList.contains('logged-in');
        header.classList.toggle('is-logged', logged);
        logout.textContent = authBtn.textContent;
    }

    function setOpen(open) {
        header.classList.toggle('menu-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(!header.classList.contains('menu-open'));
    });

    document.addEventListener('click', function (e) {
        if (!header.classList.contains('menu-open')) return;
        if (e.target.closest('.header-nav') || e.target.closest('.mobile-menu-btn')) return;
        setOpen(false);
    });

    nav.addEventListener('click', function (e) {
        if (e.target.closest('a')) setOpen(false);
    });

    window.addEventListener('resize', function () {
        if (window.innerWidth > 900) setOpen(false);
    });

    window.addEventListener('pageshow', function () {
        setOpen(false);
    });

    if (authBtn) {
        new MutationObserver(sync).observe(authBtn, { attributes: true, childList: true, characterData: true, subtree: true });
        sync();
    }

    window.dispatchEvent(new Event('resize'));
})();
