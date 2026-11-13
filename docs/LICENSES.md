# License integration

Create a **validate** token in Staff Panel → License System → API clients for normal product integrations. Use **issue** scope only for trusted provisioning services. Store the token server-side. The full token is shown only on creation; disabling it blocks future calls immediately.

## Validate a key

Send JSON to `POST https://YOUR-STORE/api/v1/licenses/validate` with:

```json
{"key":"ONYX-<customer-key>","productId":123}
```

Use headers `Content-Type: application/json` and `Authorization: Bearer <API-token>`. Allow access only when the HTTP request succeeds, `valid` is exactly `true`, and the returned `productId` matches the expected product. The API accepts omitted productId for compatibility; new integrations should always bind the product. Do not treat network failure as validation success.

## Activate an installation

Send JSON to `POST /api/v1/licenses/activate`:

```json
{"key":"ONYX-<customer-key>","productId":123,"installationId":"stable-server-installation-id"}
```

Use a stable, non-secret installation identifier (8–200 characters). The server stores its hash. Repeating activation for the same identifier does not consume another slot. A new identifier is rejected with HTTP 409 when the limit is reached. HTTP 403 means the license is inactive, expired, for another product, or tied to an order that is not paid.

Deactivate with `POST /api/v1/licenses/deactivate` and JSON containing key and installationId. A customer or admin can also remove an activation in the web panel. Integrations should periodically revalidate/re-activate as appropriate so revocation, expiry, changed keys and removed installations take effect. A removed installation can activate again if it still holds a valid key and a slot is available; reset is not a device ban. To invalidate the old credentials entirely, rotate the key or revoke the license. Offline enforcement/caching is not supplied by this release.

## Issuance

Manual customer grants are available to admins and owners in the Staff Panel. External provisioning can use `POST /api/v1/licenses/issue` with productId and optional userId using an issue-scoped token. It returns the generated key, activation limit and expiry. Repeating external issue calls creates separate licenses; it does not claim payment occurred. For retry-safe customer grants, use the staff assignment endpoint with a stable UUID requestId.

Store purchase issuance is reconciled from existing database orders recorded as paid. One license is created per digital order-item unit. Reconciliation is transactional and retry-safe. The configured Stripe/PayPal payment service verifies provider state, records payment and invokes `createService(db).fulfillOrder(orderId)`. The license worker also runs every minute. Checkout snapshots preserve licensing defaults even if product settings change before payment. See [payment setup](PAYMENTS.md).

Refunded/cancelled order licenses are rejected by the validation API immediately on subsequent requests; background reconciliation also revokes them and clears activations. Returning an order to paid does not automatically restore previously revoked keys. An admin can explicitly reactivate a paid-order license if appropriate.

## Key lifecycle and recovery

Test-order keys are accepted only by the matching test-mode license API, and are rejected after switching the license API to live mode. Manual grants and legacy orders without a mode retain their existing behavior.

Customer `/licenses` lists only that account's grants. Active customers may reveal/copy a key, generate a random replacement and remove activations. They cannot choose weak custom keys or edit entitlement settings. Rotation invalidates the original key immediately and clears activation records. License metadata and mutation audit history are retained; there is no destructive license-delete endpoint.

Keys are encrypted using the local `.onyx-license-key` file and additionally indexed by a SHA-256 hash. Keep the master-key file with your database backups; never commit or share it. The application refuses to start if encrypted rows exist and the file is missing. Restoring the wrong file does not decrypt existing keys. Legacy hash-only licenses continue validating but require rotation before their key can be revealed in the panel.

The new functionality has been checked with HTTP tests, simulated transactional SQL responses and local browser flows. Production MySQL migrations, live Wisp storage permissions, and product/server integrations must still be validated on the configured installation.
