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
            copy.className = 'standalone-product-copy';
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
            const productDetails = {
                PawDoku: {
                    lede: 'Place one cat in every row, column, and colour region—with no two cats touching. Every board has one proven solution, so logic always beats guessing.',
                    cards: [
                        ['One rule set, real depth', 'Rows, columns, coloured regions, and the no-touching rule combine into compact puzzles that keep opening up.'],
                        ['Every board verified', 'The generator searches for a second solution and rejects the board if one exists. What you receive is uniquely solvable.'],
                        ['Play your way', 'Use the focused Android app or play immediately in the browser. Progress stays on the device you use.'],
                    ],
                },
                'Kata·Word': {
                    lede: 'Guess the hidden word in English or Bahasa Indonesia. Choose a short, standard, or longer board and use every colour clue carefully.',
                    cards: [
                        ['Two languages', 'Switch between English and Bahasa Indonesia, with word lists made for each language rather than translated guesses.'],
                        ['Choose the pace', 'Play with four, five, or six-letter words depending on how quick—or demanding—you want the round to be.'],
                        ['Clear feedback', 'Letter colours show what belongs, what moves, and what is absent, with duplicate letters scored consistently.'],
                    ],
                },
                'StackO!': {
                    lede: 'Drop moving blocks with precision, protect the width of your tower, and build a streak of perfect placements as the pace climbs.',
                    cards: [
                        ['Simple to start', 'One action controls the whole game: place the moving block. The challenge comes from timing it well.'],
                        ['Precision is rewarded', 'Perfect drops preserve your platform and build momentum; misses cut away the part that did not overlap.'],
                        ['Endless runs', 'There is no final level. Chase a cleaner rhythm, a taller stack, and a better personal score each time.'],
                    ],
                },
                '2048': {
                    lede: 'Slide every tile together, merge equal numbers, and keep one clean corner as the board fills. Reaching 2048 does not end the run.',
                    cards: [
                        ['The classic rules', 'Every swipe moves the full board. Equal neighbours merge once, creating space and a larger tile.'],
                        ['Keep going', '2048 is a milestone, not a finish line. Continue toward 4096, 8192, and the best score your board can hold.'],
                        ['Built-in recovery', 'Undo gives a bad swipe a second look, while your current board and personal scores stay saved locally.'],
                    ],
                },
                Rekta: {
                    lede: 'Divide the grid into rectangles so every region contains exactly one clue and its area matches that clue. Nothing needs guessing.',
                    cards: [
                        ['Pure Shikaku', 'Each clue describes the area of one rectangle. The finished board covers every cell without overlaps or gaps.'],
                        ['Fresh boards', 'Levels are generated for continued play, with clue density and rectangle shapes changing as difficulty rises.'],
                        ['Reasonable by design', 'The puzzle is built around deduction. Use dimensions, boundaries, and competing clues to find what must fit.'],
                    ],
                },
                'PourFect!': {
                    lede: 'Sort layered colours between bottles, plan around the one-way collector tube, and recover a clean solution without dead-ending the board.',
                    cards: [
                        ['Every board solvable', 'A solver checks each generated level before it reaches you, so the puzzle never depends on blind luck.'],
                        ['A meaningful constraint', 'The collector tube accepts a colour but does not pour back, turning an ordinary water sort into a planning puzzle.'],
                        ['Accessible colour', 'The palette is chosen for strong separation, and difficulty grows through the puzzle rather than indistinguishable hues.'],
                    ],
                },
            };
            const product = productDetails[title.textContent.trim()];
            if (product) description.textContent = product.lede;
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
            const featureImages = {
                PawDoku: '/assets/pawdoku-feature.png',
                'Kata·Word': '/assets/kata_word-feature.png',
                'StackO!': '/assets/stacko-feature.png',
                '2048': '/assets/2048-feature.png',
                Rekta: '/assets/rekta-feature.png',
                'PourFect!': '/assets/pourfect-feature.png',
            };
            const featureImage = featureImages[title.textContent.trim()];
            if (featureImage) {
                icon.classList.add('has-feature');
                icon.style.backgroundImage = `url('${featureImage}')`;
            }
            hero.append(copy, icon);

            const detailGrid = document.createElement('section');
            detailGrid.className = 'standalone-detail-grid';
            for (const [heading, body] of product?.cards || []) {
                const article = document.createElement('article');
                const cardTitle = document.createElement('h2');
                const cardBody = document.createElement('p');
                cardTitle.textContent = heading;
                cardBody.textContent = body;
                article.append(cardTitle, cardBody);
                detailGrid.append(article);
            }
            game.replaceChildren(back, hero, detailGrid, guide);
        }
    }
});
