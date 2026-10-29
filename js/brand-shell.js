/* One shared shell for every informational page. The pages keep semantic
   fallback navigation in their HTML, while this replaces it with the current
   Artivy games-and-apps navigation when JavaScript is available. */
document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.navbar');
    if (header) {
        header.className = 'site-nav content-site-nav';
        header.innerHTML = `
            <a class="brand" href="/" aria-label="Artivy home">
                <img src="/assets/logo.svg" alt="Artivy" width="145" height="50">
            </a>
            <nav aria-label="Primary">
                <a href="/#games">Games</a>
                <a href="/#apps">Apps</a>
                <a href="/about.html">Studio</a>
                <a class="nav-contact" href="/contact.html">Contact</a>
            </nav>`;
    }

    const footer = document.querySelector('footer');
    if (footer) {
        footer.className = 'site-footer content-site-footer';
        footer.innerHTML = `
            <div>
                <img src="/assets/logo.svg" alt="Artivy" width="145" height="50">
                <p>Thoughtful games and useful apps,<br>made independently in Indonesia.</p>
            </div>
            <nav aria-label="Footer">
                <div><b>Explore</b><a href="/#games">Games</a><a href="/#apps">Apps</a><a href="/about.html">About</a></div>
                <div><b>Support</b><a href="/contact.html">Contact</a><a href="/privacy.html">Website privacy</a></div>
            </nav>
            <p class="copyright">© 2026 Artivy</p>`;
    }
});
