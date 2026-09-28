# Disposition Lead API

Node.js API that stores each customer disposition as its own Salesforce `DispositionLead__c` record. A later event for the same phone or email creates a new row. An existing row changes only when `PATCH /api/disposition-leads/:id` is called with that Salesforce record id.

The backend authenticates with the Salesforce OAuth 2.0 JWT bearer flow. Credentials are read from the environment. They are not hardcoded and are never written to logs or API responses.

## Requirements

- Node.js 18 or newer
- A Salesforce org (production or sandbox)
- An External Client App or Connected App already created for JWT bearer login

## Salesforce setup

Put the target account in `.env`, then run one command. The script logs in with those credentials and deploys the custom object, fields, page layout, and permission set to that org. It also assigns the permission set to `SALESFORCE_USERNAME`.

Change the account by editing `.env` (`SALESFORCE_LOGIN_URL`, `SALESFORCE_CLIENT_ID`, `SALESFORCE_USERNAME`, and the private key). Run the same command again. Each run uses whatever credentials are in `.env` at that moment. Restart `npm start` afterward so the API uses the new account too.

```bash
npm run setup
```

The Connected App must already exist in that org. The script needs it to log in. The user in `SALESFORCE_USERNAME` must be allowed to deploy metadata (a System Administrator, or a user with Customize Application).

`sf project deploy start --source-dir force-app` remains available if you prefer the Salesforce CLI.

### 1. What the script creates

Metadata in `force-app/` defines:

- Custom object `DispositionLead__c` (label: Disposition Lead)
- Auto-number name `DL-{000000}` (Salesforce requires a name field; this API does not accept or return it)
- The fields listed below
- Page layout `DispositionLead__c-Disposition Lead Layout`
- Permission set `Disposition Lead Integration`

| Label | API name | Type |
| --- | --- | --- |
| Contact ID | `ContactId__c` | Text(18) |
| First Name | `FirstName__c` | Text(255) |
| Middle Name | `MiddleName__c` | Text(255) |
| Last Name | `LastName__c` | Text(255) |
| Phone | `Phone1__c` | Phone |
| Email | `Email1__c` | Email |
| Country | `Country__c` | Text(255) |
| City | `City__c` | Text(255) |
| State | `State__c` | Text(255) |
| Street | `Street__c` | Text(255) |
| ZIP | `Zip__c` | Text(255) |
| Metric 1–4 | `Metric1__c` … `Metric4__c` | Number(18, 2) |
| Disposition Status | `DispositionStatus__c` | Text(255) |
| Disposition Date/Time | `DispositionDateTime__c` | Date/Time |

`DispositionDateTime__c` is the only date/time field. It is the moment the disposition occurred.

### 2. Integration user permissions

Assign the `Disposition Lead Integration` permission set to the integration user. That set grants:

- API Enabled
- Create, Read, and Edit on `DispositionLead__c`
- Read and edit field-level security for every field above

It does not grant Delete, View All, or Modify All. Do not add those unless a later feature needs them.

The integration user also needs to be allowed to use the External Client App / Connected App (pre-authorized, or included in the “Admin approved users are pre-authorized” policy).

### 3. External Client App or Connected App

Create an External Client App (or a Connected App, if the org still uses that model) for this backend:

1. Enable OAuth.
2. Use the JWT bearer flow with a digital certificate. Upload the public certificate (`.crt` / `.pem`). Keep the matching private key outside the repository.
3. OAuth scope: `api` (`Access and manage your data`). JWT bearer does not use a refresh token. Add `refresh_token` only when the org’s setup screen requires a second scope.
4. Permitted users: Admin approved users are pre-authorized. Approve the integration user.
5. Copy the Consumer Key into `SALESFORCE_CLIENT_ID`.
6. Use the integration user’s username as `SALESFORCE_USERNAME`.
7. Put the certificate’s private key in `SALESFORCE_PRIVATE_KEY` or point `SALESFORCE_PRIVATE_KEY_PATH` at the key file.

The JWT audience (`aud`) is the login URL:

- Production: `https://login.salesforce.com`
- Sandbox: `https://test.salesforce.com`

Some orgs require the My Domain URL as the audience. If Salesforce rejects the token with an audience error, set `SALESFORCE_LOGIN_URL` to the exact audience configured on the connected app. The token endpoint is `{SALESFORCE_LOGIN_URL}/services/oauth2/token`.

## Environment variables

Copy `.env.example` to `.env`. Never commit `.env`, `.pem`, or `.key` files.

```env
SALESFORCE_LOGIN_URL=https://login.salesforce.com
SALESFORCE_CLIENT_ID=
SALESFORCE_USERNAME=
SALESFORCE_PRIVATE_KEY=
SALESFORCE_PRIVATE_KEY_PATH=
SALESFORCE_API_VERSION=v64.0
PORT=3000
```

Sandbox:

```env
SALESFORCE_LOGIN_URL=https://test.salesforce.com
```

Private key rules:

- If `SALESFORCE_PRIVATE_KEY` is non-empty, it is used.
- Otherwise the file at `SALESFORCE_PRIVATE_KEY_PATH` is used.
- A value with escaped newlines (`\n`) is converted to real newlines before the JWT is signed.
- Example inline value:

```env
SALESFORCE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

On startup the process prints only whether each setting is configured. It does not print the values. If any required setting is missing, the process exits.

```text
Salesforce configuration:
  LOGIN_URL: configured
  CLIENT_ID: configured
  USERNAME: configured
  PRIVATE_KEY: configured
  API_VERSION: configured
```

Access tokens are cached in memory for 50 minutes and refreshed one minute before that. They are not stored in a database. A Salesforce `401` clears the cache and retries once.

`SALESFORCE_API_VERSION` is the only API version used for REST calls (for example `v64.0`).

## Run

```bash
npm install
npm run setup
npm start
```

`npm run setup` creates the Disposition Lead object in the Salesforce org for the credentials currently in `.env`. `npm run seed` inserts 12 sample disposition records into that org. Running it again skips records that are already there. The API listens on `PORT` (default `3000`).

```bash
npm test
```

Tests use generated RSA keys and mocked HTTP. They do not call Salesforce.

## API

All error responses use this shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "At least phone1 or email1 is required"
  }
}
```

| Code | HTTP | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Invalid body, query, or record id |
| `NOT_FOUND` | 404 | Unknown route or Salesforce record |
| `SALESFORCE_AUTH_ERROR` | 502 | JWT or token exchange failed |
| `SALESFORCE_API_ERROR` | 502 | Salesforce data API failed |
| `CONFIG_ERROR` | 500 | Salesforce environment is incomplete |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

### Create

`POST /api/disposition-leads`

Always inserts a new history record. At least one of `phone1` or `email1` is required. If `dispositionDateTime` is omitted, the server uses the current UTC time.

```bash
curl -X POST http://localhost:3000/api/disposition-leads \
  -H "Content-Type: application/json" \
  -d "{\"contactId\":\"003XXXXXXXXXXXX\",\"firstName\":\"John\",\"middleName\":\"A\",\"lastName\":\"Doe\",\"phone1\":\"9876543210\",\"email1\":\"john@example.com\",\"country\":\"India\",\"city\":\"Mumbai\",\"state\":\"Maharashtra\",\"street\":\"ABC Street\",\"zip\":\"400001\",\"metric1\":10,\"metric2\":20,\"metric3\":30,\"metric4\":40,\"dispositionStatus\":\"Interested\",\"dispositionDateTime\":\"2026-09-28T09:15:00Z\"}"
```

```json
{
  "success": true,
  "id": "a01XXXXXXXXXXXX",
  "message": "Disposition lead created successfully"
}
```

### Update

`PATCH /api/disposition-leads/:id`

Updates only the fields present in the body. Omitted fields stay as they are. `null` clears a field. This does not insert a history row.

```bash
curl -X PATCH http://localhost:3000/api/disposition-leads/a01XXXXXXXXXXXX \
  -H "Content-Type: application/json" \
  -d "{\"dispositionStatus\":\"Callback\",\"metric1\":25}"
```

```json
{
  "success": true,
  "id": "a01XXXXXXXXXXXX",
  "message": "Disposition lead updated successfully"
}
```

`:id` must be a 15- or 18-character Salesforce id.

### Search

`GET /api/disposition-leads`

Query parameters (all optional, combined with AND):

| Param | Behavior |
| --- | --- |
| `phone1` | Exact match on `Phone1__c` |
| `email1` | Exact match on `Email1__c` |
| `dispositionStatus` | Exact match on `DispositionStatus__c` |
| `fromDate` | Inclusive lower bound on `DispositionDateTime__c` |
| `toDate` | Inclusive upper bound |
| `date` | One UTC calendar day |
| `sort` | `newest` (default) or `earliest` |
| `page` | Page number, default `1` |
| `pageSize` | Default `50`, maximum `200` |

Phone and email are both applied when both are sent. The API does not pick one of them.

No filters returns a page of records ordered newest first.

Salesforce `OFFSET` cannot exceed 2000. A deeper page returns `VALIDATION_ERROR`.

```bash
curl "http://localhost:3000/api/disposition-leads?phone1=9876543210&dispositionStatus=Interested&fromDate=2026-09-01&toDate=2026-09-28&sort=newest"
```

```json
{
  "success": true,
  "data": [
    {
      "id": "a01XXXXXXXXXXXX",
      "contactId": "003XXXXXXXXXXXX",
      "firstName": "John",
      "middleName": "A",
      "lastName": "Doe",
      "phone1": "9876543210",
      "email1": "john@example.com",
      "country": "India",
      "city": "Mumbai",
      "state": "Maharashtra",
      "street": "ABC Street",
      "zip": "400001",
      "metric1": 10,
      "metric2": 20,
      "metric3": 30,
      "metric4": 40,
      "dispositionStatus": "Interested",
      "dispositionDateTime": "2026-09-28T09:15:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "totalSize": 1
}
```

Sort:

- `sort=newest` → `DispositionDateTime__c DESC`
- `sort=earliest` → `DispositionDateTime__c ASC`

### Dates and time zone

Every bound is UTC.

- Date-only `YYYY-MM-DD` is a full UTC calendar day. `fromDate=2026-09-01` means `>= 2026-09-01T00:00:00Z`. `toDate=2026-09-28` means `< 2026-09-29T00:00:00Z` (the 28th is included).
- An ISO-8601 timestamp (`2026-09-01T00:00:00Z` or an offset such as `+05:30`) is an exact instant. `fromDate` is inclusive (`>=`). `toDate` is inclusive (`<=`).
- `date=2026-09-28` is that single UTC day.
- `dispositionDateTime` on create must include a zone (`Z` or a numeric offset). Responses are UTC ISO-8601.

Filter values are validated and SOQL string literals are escaped. User input is not concatenated into SOQL raw.

## Project layout

```text
src/config/salesforce.js
src/services/salesforce/auth.js
src/services/salesforce/client.js
src/services/salesforce/dispositionLead.js
src/controllers/dispositionLeadController.js
src/routes/dispositionLeadRoutes.js
src/utils/soql.js
src/utils/validation.js
force-app/
```

## Assumptions

- Metrics use Number(18, 2). Phone values are matched exactly as stored, up to 40 characters. Email values are matched exactly, up to 80 characters.
- `DispositionStatus__c` is free text, not a picklist.
- The API does not delete records.
- The previous prototype in `index.js` hardcoded credentials. Those values were removed. Rotate that certificate and private key in Salesforce if they were ever shared or committed.
