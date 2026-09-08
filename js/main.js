/*
 * The home page's only script: the card strip's arrows.
 *
 * Two things used to live here and both are gone. A WebGL particle field pulled Three.js
 * from a CDN, built a 3,600-point grid and repainted it every frame for as long as the tab
 * was open — the speckles are three drifting dot layers in CSS now. And a scroll-reveal
 * observer held the page's own content at `opacity: 0` until it fired, which made the
 * content conditional on a callback that a backgrounded tab never delivers.
 *
 * A play page must still never load this file: the strip does not exist there.
 */

/*
 * Arrows for the card strip, each shown only while there is somewhere to go that way.
 *
 * Built here rather than written into the HTML, because they do nothing without this script and
 * a dead control is worse than no control — the strip swipes and scrolls on its own either way.
 *
 * A click advances by one card. `scrollBy` is smooth and cooperates with the strip's scroll
 * snapping, so the strip settles on a card rather than between two.
 */
document.querySelectorAll('.strip-wrap').forEach((wrap) => {
    const strip = wrap.querySelector('.card-strip');
    if (!strip) return;

    const arrows = ['left', 'right'].map((side) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `strip-arrow strip-arrow-${side}`;
        button.setAttribute('aria-label', side === 'left' ? 'Previous game' : 'Next game');
        // Drawn rather than typed: an arrow glyph sits differently in every fallback font.
        button.innerHTML = '<span class="strip-chevron"></span>';
        button.addEventListener('click', () => {
            const card = strip.querySelector(':scope > *');
            const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
            const step = card ? card.getBoundingClientRect().width + gap : strip.clientWidth;
            strip.scrollBy({ left: side === 'left' ? -step : step, behavior: 'smooth' });
        });
        wrap.appendChild(button);
        return button;
    });

    const update = () => {
        // A pixel of slack: scrollLeft is fractional on a zoomed or high-DPI display, so an
        // exact comparison leaves the far arrow showing at the end of the strip forever.
        const max = strip.scrollWidth - strip.clientWidth - 1;
        arrows[0].hidden = strip.scrollLeft <= 1;
        arrows[1].hidden = strip.scrollLeft >= max;
    };

    update();
    strip.addEventListener('scroll', update, { passive: true });
    // Cards are a share of the viewport, so a resize changes both ends of the range.
    new ResizeObserver(update).observe(strip);
});
