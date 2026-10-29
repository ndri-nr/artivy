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

    const game = document.querySelector('.game-info-container');
    if (game) {
        const back = game.querySelector(':scope > .back-button');
        const icon = game.querySelector(':scope > .game-icon-wrapper');
        const title = game.querySelector(':scope > h1');
        const description = game.querySelector(':scope > p:not(.play-now)');
        const play = game.querySelector(':scope > .play-now a');
        const legal = game.querySelector(':scope > .game-links-grid');
        const store = game.querySelector(':scope > .play-badge');
        const guide = game.querySelector(':scope > .guide');

        if (back && icon && title && description && play && legal && store && guide) {
            game.className = 'standalone-product-page';
            back.className = 'product-back';

            const hero = document.createElement('section');
            hero.className = 'standalone-product-hero';
            const copy = document.createElement('div');
            const kicker = document.createElement('p');
            kicker.className = 'section-kicker';
            kicker.textContent = 'Standalone game · Android & web';
            description.className = 'lede';

            const facts = document.createElement('div');
            facts.className = 'fact-row';
            const factSets = {
                PawDoku: ['Logic puzzle', 'Unique solution', 'Offline play', 'No purchases'],
                'Kata·Word': ['English & Indonesian', 'Three word lengths', 'Offline play', 'No purchases'],
                'StackO!': ['Precision arcade', 'Endless runs', 'Offline play', 'No purchases'],
                '2048': ['Number puzzle', 'Undo support', 'Offline play', 'No purchases'],
                Rekta: ['Shikaku puzzle', 'Generated boards', 'Offline play', 'No purchases'],
                'PourFect!': ['Water sorting', 'Proven solvable', 'Offline play', 'No purchases'],
            };
            for (const fact of factSets[title.textContent.trim()] || ['Android & web', 'Offline play', 'No purchases']) {
                const tag = document.createElement('span');
                tag.textContent = fact;
                facts.append(tag);
            }

            const actions = document.createElement('div');
            actions.className = 'product-actions';
            play.className = 'button button-dark';
            play.textContent = 'Play in your browser →';
            store.className = 'button button-outline';
            store.textContent = 'Google Play ↗';
            actions.append(play, store);

            legal.className = 'legal-row';
            for (const link of legal.querySelectorAll('a')) link.removeAttribute('class');
            copy.append(kicker, title, description, facts, actions, legal);
            icon.className = 'standalone-product-art';
            hero.append(copy, icon);
            game.replaceChildren(back, hero, guide);
        }
    }
});
