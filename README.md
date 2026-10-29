# Artivy website

This is the single source for `https://artivy.id`: the studio homepage, browser
games, product pages, legal documents, Play listing support pages, and publisher
declarations.

## Content structure

```text
games/<slug>/              game page, browser build, privacy, and terms
apps/<slug>/               app page, privacy, and terms
assets/                    shared brand and product art
publisher/                 ads.txt and app-ads.txt source files
```

Public URLs preserve that structure:

- `games/pawdoku/privacy-policy.html` becomes
  `https://artivy.id/games/pawdoku/privacy-policy.html`
- `apps/adledger/privacy-policy.html` becomes
  `https://artivy.id/apps/adledger/privacy-policy.html`

The deployment also creates root-level compatibility copies such as
`/pawdoku/privacy-policy.html`. Those are for old Android builds and are not the
canonical URLs for new Play listings.

## Updating a product

For a privacy or terms change, edit the document inside that product folder and
update its effective date. For a Play listing change, update the product landing
page in the same folder and keep the package's store assets in its application
repository. If a new product is added:

1. Create `games/<slug>/` or `apps/<slug>/`.
2. Add its landing page, privacy policy, and terms.
3. Add its card to the homepage.
4. Add its canonical URLs to `sitemap.xml`.
5. Set the Play listing website to the canonical product landing page.

## Domain and publishing

GitHub Actions publishes this repository to GitHub Pages at `artivy.id`. The
Cloudflare DNS zone points the apex domain at GitHub Pages. `publisher/ads.txt`
and `publisher/app-ads.txt` are copied to the public domain root during deploy;
do not move them into an individual product folder.
