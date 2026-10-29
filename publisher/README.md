# Publisher files

These files are copied to the deployed domain root by the Pages workflow:

- `app-ads.txt` is crawled by AdMob for every Artivy Play listing.
- `ads.txt` is crawled by AdSense for the browser games.

They live in this repository so `artivy` is the only website repository that
needs ongoing maintenance. Do not move them below a product directory: Google
only checks the domain root.
