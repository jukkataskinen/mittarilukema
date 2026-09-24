import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Auth0-asiakas. Asetukset ympäristömuuttujista: AUTH0_DOMAIN,
 * AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL.
 * Vain henkilökunta kirjautuu; asiakkaat ilmoittavat lukemat tekstiviestillä
 * tai kertakäyttöisellä linkillä ilman tunnusta.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: { ui_locales: "fi" },
});
