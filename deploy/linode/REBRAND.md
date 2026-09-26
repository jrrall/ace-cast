# omfg.cards domain cutover

The application displays omfg.cards. Existing rooms and the internal `madlad` game identifier are unchanged.

For an existing installation:

1. Point the new domain’s DNS at the production server.
2. Add `omfg.cards` to the reverse proxy site configuration and provision HTTPS.
3. Set `PUBLIC_URL=https://omfg.cards` in the production app environment so new QR codes and join links use the new domain. Update the deployment’s `SITE_ADDRESS` accordingly.
4. Update authentication cookie domains and auth portal URLs if the existing deployment pins them to the old domain. Verify sign-in before redirecting the old hostname.
5. Deploy the app and check room creation, QR links, two-player automatic start, and the TV display on the new domain.

Keep the old hostname available during active games. A redirect or hostname change can interrupt sockets and browser-scoped player identity, so schedule the redirect after those games finish.

These are deployment steps; the source rebrand does not change live DNS or production configuration.
