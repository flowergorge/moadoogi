# Moadoogi Cloudflare Worker backend

The frontend is a static GitHub Pages site. Firebase Authentication signs the user in on the client; the client passes the Firebase **ID token** in the Authorization header. Cloudflare Workers validates that token against Google's securetoken JWKS, uses its verified Firebase UID for D1 queries, and extracts remote page titles on the server.

The Worker has no npm dependencies. You only need Node.js to run the included tests, and Wrangler to develop/deploy. Cloudflare and Firebase projects must be provisioned separately. No credentials or private keys belong in this repository.

## Deployment setup

1. In Firebase, create a Firebase project, enable Authentication > Sign-in method > Google, and add the final GitHub Pages domain in Authorized domains. Record the Firebase **Project ID** (the exact project ID, not the API key).
2. From the worker folder run:

        npx wrangler login
        npx wrangler d1 create moadoogi

   Copy the returned D1 database UUID into worker/wrangler.jsonc under database_id.
3. In worker/wrangler.jsonc set FIREBASE_PROJECT_ID to your exact Firebase project ID, and ALLOWED_ORIGINS to the exact frontend origin. For GitHub Pages hosted at https://someone.github.io/moadoogi/, the **origin** is https://someone.github.io (there is no path or trailing slash). Multiple deliberate origins may be comma separated, such as a production GitHub Pages origin and http://localhost:5500 for local development. Avoid a broad '*' setting.
4. Initialize and preview locally, from the worker folder:

        npx wrangler d1 migrations apply moadoogi --local
        npx wrangler dev --local

5. When ready to deploy:

        npx wrangler d1 migrations apply moadoogi --remote
        npx wrangler deploy

   The deployment prints a workers.dev URL (or configured custom domain). Put that URL in the frontend's Worker API base configuration, e.g. https://moadoogi-api.ACCOUNT.workers.dev. Deploying or remote migrations require access to your Cloudflare account and are **not performed** by this repository.

## API

Every endpoint, including metadata, requires an authentic Firebase ID token in the bearer header. A Firebase API key or Google access token is **not** a substitute for a Firebase ID token.

All JSON requests use Content-Type: application/json. The Worker sends exact-origin CORS headers, accepts a preflight OPTIONS from configured origins, and rejects any explicitly unapproved Origin. CLI/native requests without an Origin are accepted with valid authentication. Errors are JSON, e.g. {"error":"invalid_token","message":"Invalid Firebase ID token"}.

**GET /api/items?offset=0** — returns `{"items":[...]}` with **up to 100 records per page** for the authenticated account. Records are ordered by `rank ASC, created DESC, id ASC`. `offset` defaults to zero; it must be a non-negative safe integer. Fetch `offset=0`, then `offset=100`, `offset=200`, etc. Stop after receiving fewer than 100 records. A row contains the stored JSON item, including its tags, starred flag, and any supplementary fields. This sort consistently resolves ties; a concurrent edit can still shift offsets between requests.

**POST /api/sync** — accepts 1–100 changes atomically (D1 batch transaction):

        {
          "changes": [
            {
              "op": "upsert",
              "item": {
                "id": "item-123",
                "title": "Saved title",
                "url": "https://example.com/",
                "note": "",
                "tags": ["research"],
                "status": "관심",
                "date": "",
                "created": "2026-10-10T10:00:00.000Z",
                "rank": 0,
                "starred": false,
                "autoTagsApplied": true
              }
            },
            {"op":"delete","id":"old-item"}
          ]
        }

Returns {"ok":true}. Entries are isolated by composite (user_id, id); deleting a matching id in another user's account is impossible. Multiple devices currently use **last successful write wins**: conflict resolution and offline merge are client concerns. To avoid overriding newer server changes, clients should load current items before uploading offline changes.

**GET /api/metadata?url=https%3A%2F%2Fexample.com%2F** — returns a JSON object with any of title, author and text that could be obtained. YouTube is checked via YouTube oEmbed and X/Twitter via its best-effort oEmbed provider; ordinary pages use OpenGraph/Twitter meta fields and the HTML title. Some sites block automated fetches or use JavaScript-only titles. Metadata errors should not prevent saving the item with its fallback title.

In client JavaScript:

        const token = await firebaseUser.getIdToken();
        const response = await fetch(API_BASE + '/api/items?offset=0', {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (!response.ok) throw new Error(await response.text());
        const { items } = await response.json();

The frontend should refresh the token with firebaseUser.getIdToken() on requests, or use the Firebase SDK's built-in refresh. Persist Firebase Auth using browserLocalPersistence; do not store ID tokens in D1 or localStorage manually.

## Limits and security

* All endpoints validate the Firebase JWT RS256 signature against Google's rotating securetoken JWKS, plus iss/aud/exp/iat/sub/auth_time (when present). Public keys follow their Cache-Control max-age. Firebase project ID must match exactly.
* CORS is an exact, configured origin check. No wildcard and no cookies. The bearer token is required separately from CORS.
* D1 is keyed by Firebase UID and item ID; each request only queries that verified UID.
* Sync is limited to 100 changes per request, 128 KiB request body, 12 KiB per JSON item, 300-character title, 5,000-character note, 24 tags, and 4,096-character URL.
* Reads are paginated at 100 items per response. Each response is limited to 2 MiB (413 if exceeded), and each stored item is limited to 12 KiB, so a full 100-item page normally stays under the response limit. There is no global 2,000-item read cap.
* Each verified UID has a shared D1 atomic counter per endpoint and minute: reads 120/minute, sync 30/minute and metadata 15/minute. More sophisticated production throttling may use Cloudflare Rate Limiting or Durable Objects.
* Metadata only fetches HTTPS public hostnames on port 443. Local names, IP literals, userinfo and internal suffixes are rejected; redirects are followed manually with destination validation and a maximum of three hops. Fetch has an 8s budget and reads at most 256 KiB of HTML or 32 KiB of oEmbed JSON. Non-HTML page content is rejected. Server-side requests still depend on Cloudflare's network DNS resolution, so internet hostname validation is a boundary-in-depth measure rather than a DNS rebinding proof.
* API responses are no-store and contain no server secrets. The public Firebase project ID and D1 database UUID are identifiers, but service-account private keys and Wrangler API tokens must never be committed.

## Local verification

Run from the worker folder:

        node --test tests/*.test.mjs

To test HTTP integration against a local D1 Worker, run migrations and wrangler dev as above. You need a real Firebase user ID token from your test Firebase project for authorized calls; unsigned mock JWTs are deliberately rejected.
