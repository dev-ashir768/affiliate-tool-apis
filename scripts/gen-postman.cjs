const fs = require("fs");
const path = require("path");

function noAuth() {
  return { type: "noauth" };
}

function req(name, method, urlPath, opts = {}) {
  const item = {
    name,
    request: {
      method,
      header: opts.body
        ? [{ key: "Content-Type", value: "application/json" }]
        : [],
      url: `{{baseUrl}}${urlPath}`,
    },
  };
  if (opts.auth === false) item.request.auth = noAuth();
  if (opts.body !== undefined) {
    item.request.body = {
      mode: "raw",
      raw: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body, null, 2),
    };
  }
  if (opts.description) item.request.description = opts.description;
  if (opts.event) item.event = opts.event;
  return item;
}

const saveTokens = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      "if (pm.response.code === 200 || pm.response.code === 201) {",
      "  const j = pm.response.json();",
      "  if (j.accessToken) pm.collectionVariables.set('accessToken', j.accessToken);",
      "  if (j.refreshToken) pm.collectionVariables.set('refreshToken', j.refreshToken);",
      "}",
    ],
  },
};

const saveShop = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      "if (pm.response.code === 200 || pm.response.code === 201) {",
      "  const j = pm.response.json();",
      "  const id = j.id || j.shop?.id;",
      "  if (id) pm.collectionVariables.set('shopId', id);",
      "}",
    ],
  },
};

const collection = {
  info: {
    _postman_id: "tiksly-affiliate-apis-full-001",
    name: "Tiksly Affiliate Tool APIs",
    description:
      "Complete API coverage for affiliate-tool-apis.\n\n**Setup**\n1. Import this collection + `Tiksly.environment.json`.\n2. Set `baseUrl` (default `http://localhost:4000`).\n3. Run **Auth → Register** or **Login** — tokens auto-save.\n4. Platform routes need a SUPERADMIN/OPS token (seed `PLATFORM_SUPERADMIN_EMAIL`).\n5. Shop connect needs org `shopLimit` > 0 (upgrade plan / DB).\n6. Shop verify needs Redis + `npm run worker`.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:4000" },
    { key: "accessToken", value: "" },
    { key: "refreshToken", value: "" },
    { key: "shopId", value: "" },
    { key: "inviteToken", value: "" },
    { key: "planCode", value: "starter" },
    { key: "creatorId", value: "" },
    { key: "listId", value: "" },
    { key: "campaignId", value: "" },
    { key: "templateId", value: "" },
    { key: "discoveryId", value: "" },
    { key: "orgId", value: "" },
    { key: "staffId", value: "" },
    { key: "proxyId", value: "" },
    { key: "navItemId", value: "" },
    { key: "navSectionId", value: "" },
    { key: "resetToken", value: "" },
  ],
  auth: {
    type: "bearer",
    bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }],
  },
  item: [
    {
      name: "Health",
      item: [req("GET Health", "GET", "/health", { auth: false })],
    },
    {
      name: "Auth",
      item: [
        req("Register", "POST", "/api/v1/auth/register", {
          auth: false,
          body: {
            email: "merchant{{$timestamp}}@example.com",
            password: "Password123!",
            name: "Merchant User",
            organizationName: "Demo Org {{$timestamp}}",
          },
          event: [saveTokens],
        }),
        req("Login", "POST", "/api/v1/auth/login", {
          auth: false,
          body: { email: "merchant@example.com", password: "Password123!" },
          event: [saveTokens],
        }),
        req("Refresh", "POST", "/api/v1/auth/refresh", {
          auth: false,
          body: { refreshToken: "{{refreshToken}}" },
          event: [saveTokens],
        }),
        req("Logout", "POST", "/api/v1/auth/logout", {
          body: { refreshToken: "{{refreshToken}}" },
        }),
        req("Me", "GET", "/api/v1/auth/me"),
        req("Forgot Password", "POST", "/api/v1/auth/forgot-password", {
          auth: false,
          body: { email: "merchant@example.com" },
        }),
        req("Reset Password", "POST", "/api/v1/auth/reset-password", {
          auth: false,
          body: { token: "{{resetToken}}", password: "Password123!" },
        }),
      ],
    },
    {
      name: "Orgs",
      item: [
        req("Get Current Org", "GET", "/api/v1/orgs/current"),
        req("Patch Current Org", "PATCH", "/api/v1/orgs/current", {
          body: { name: "Updated Org Name" },
        }),
        req("List Members", "GET", "/api/v1/orgs/current/members?page=1&pageSize=20"),
        req("Create Invite", "POST", "/api/v1/orgs/current/invites", {
          body: { email: "teammate@example.com", role: "MEMBER" },
        }),
        req("Accept Invite", "POST", "/api/v1/orgs/invites/{{inviteToken}}/accept", {
          auth: false,
          body: {
            password: "Password123!",
            name: "Teammate",
          },
        }),
      ],
    },
    {
      name: "Billing",
      item: [
        req("List Plans", "GET", "/api/v1/billing/plans", { auth: false }),
        req("Create Checkout Session", "POST", "/api/v1/billing/checkout-session", {
          body: {
            planCode: "{{planCode}}",
            successUrl: "http://localhost:3000/billing/success",
            cancelUrl: "http://localhost:3000/billing/cancel",
          },
        }),
        req("Create Portal Session", "POST", "/api/v1/billing/portal-session", {
          body: { returnUrl: "http://localhost:3000/billing" },
        }),
        req("Stripe Webhook (manual)", "POST", "/api/v1/webhooks/stripe", {
          auth: false,
          body: {},
          description: "Prefer Stripe CLI. Needs Stripe-Signature header + raw body.",
        }),
      ],
    },
    {
      name: "Shops",
      item: [
        req("List Shops", "GET", "/api/v1/shops"),
        req(
          "Connect Shop",
          "POST",
          "/api/v1/shops/connect",
          {
            body: { region: "US" },
            event: [saveShop],
          }
        ),
        req("Get Shop", "GET", "/api/v1/shops/{{shopId}}"),
        req("Verify Shop", "POST", "/api/v1/shops/{{shopId}}/verify"),
        req("Disconnect Shop", "DELETE", "/api/v1/shops/{{shopId}}"),
      ],
    },
    {
      name: "Creators CRM",
      item: [
        req("List Creators", "GET", "/api/v1/creators"),
        req("Create Creator", "POST", "/api/v1/creators", {
          body: {
            handle: "creator_{{$timestamp}}",
            displayName: "Creator",
            region: "US",
            contactEmail: "creator@example.com",
          },
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "if (pm.response.code === 201) {",
                  "  const j = pm.response.json();",
                  "  if (j.id) pm.collectionVariables.set('creatorId', j.id);",
                  "}",
                ],
              },
            },
          ],
        }),
        req("Patch Creator", "PATCH", "/api/v1/creators/{{creatorId}}", {
          body: { stage: "INVITED", notes: "Follow up" },
        }),
        req("Delete Creator", "DELETE", "/api/v1/creators/{{creatorId}}"),
        req("List Lists", "GET", "/api/v1/creators/lists"),
        req("Create List", "POST", "/api/v1/creators/lists", {
          body: { name: "VIP {{$timestamp}}" },
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "if (pm.response.code === 201) {",
                  "  const j = pm.response.json();",
                  "  if (j.id) pm.collectionVariables.set('listId', j.id);",
                  "}",
                ],
              },
            },
          ],
        }),
        req("Add List Member", "POST", "/api/v1/creators/lists/{{listId}}/members", {
          body: { creatorId: "{{creatorId}}" },
        }),
        req("List Campaigns", "GET", "/api/v1/creators/campaigns"),
        req("Create Campaign", "POST", "/api/v1/creators/campaigns", {
          body: { name: "Launch {{$timestamp}}", status: "DRAFT" },
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "if (pm.response.code === 201) {",
                  "  const j = pm.response.json();",
                  "  if (j.id) pm.collectionVariables.set('campaignId', j.id);",
                  "}",
                ],
              },
            },
          ],
        }),
        req("Patch Campaign", "PATCH", "/api/v1/creators/campaigns/{{campaignId}}", {
          body: { status: "ACTIVE" },
        }),
      ],
    },
    {
      name: "Outreach",
      item: [
        req("List Templates", "GET", "/api/v1/outreach/templates"),
        req("Create Template", "POST", "/api/v1/outreach/templates", {
          body: {
            name: "Collab {{$timestamp}}",
            subject: "Hi {{displayName}}",
            bodyText: "Hello @{{handle}}",
          },
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "if (pm.response.code === 201) {",
                  "  const j = pm.response.json();",
                  "  if (j.id) pm.collectionVariables.set('templateId', j.id);",
                  "}",
                ],
              },
            },
          ],
        }),
        req("Patch Template", "PATCH", "/api/v1/outreach/templates/{{templateId}}", {
          body: { subject: "Updated {{displayName}}" },
        }),
        req("List Messages", "GET", "/api/v1/outreach/messages"),
        req("Send Outreach", "POST", "/api/v1/outreach/send", {
          body: {
            creatorId: "{{creatorId}}",
            templateId: "{{templateId}}",
          },
        }),
      ],
    },
    {
      name: "Discovery",
      item: [
        req("Search Discovery Creators", "GET", "/api/v1/discovery/creators?page=1&pageSize=20"),
        req("Save Discovery To CRM", "POST", "/api/v1/discovery/creators/{{discoveryId}}/save"),
      ],
    },
    {
      name: "Orders & Analytics",
      item: [
        req("List Orders", "GET", "/api/v1/orders"),
        req("Create Order", "POST", "/api/v1/orders", {
          body: {
            externalOrderId: "ORD-{{$timestamp}}",
            gmvCents: 4999,
            currency: "USD",
            status: "PAID",
            orderedAt: "2026-09-21T12:00:00.000Z",
            creatorId: "{{creatorId}}",
            commissionCents: 500,
          },
        }),
        req("Analytics Overview", "GET", "/api/v1/analytics/overview"),
      ],
    },
    {
      name: "Navigation",
      item: [
        req("Get Dashboard Nav", "GET", "/api/v1/navigation/dashboard"),
        req("Get Backoffice Nav", "GET", "/api/v1/navigation/backoffice"),
      ],
    },
    {
      name: "Platform — Staff & Orgs",
      item: [
        req("List Staff", "GET", "/api/v1/platform/staff"),
        req("Invite Staff", "POST", "/api/v1/platform/staff", {
          body: {
            email: "ops{{$timestamp}}@platform.local",
            role: "OPS",
            password: "Password123!",
            name: "Ops User",
          },
        }),
        req("Patch Staff", "PATCH", "/api/v1/platform/staff/{{staffId}}", {
          body: { role: "OPS" },
        }),
        req("List Organizations", "GET", "/api/v1/platform/organizations"),
        req("Get Organization", "GET", "/api/v1/platform/organizations/{{orgId}}"),
        req("List Platform Shops", "GET", "/api/v1/platform/shops"),
        req("Billing Overview", "GET", "/api/v1/platform/billing/overview"),
        req("Audit Log", "GET", "/api/v1/platform/audit?page=1&pageSize=50"),
      ],
    },
    {
      name: "Platform — Proxies & Crawler",
      item: [
        req("List Proxies", "GET", "/api/v1/platform/proxies"),
        req("Create Proxy", "POST", "/api/v1/platform/proxies", {
          body: {
            label: "proxy-{{$timestamp}}",
            host: "127.0.0.1",
            port: 8080,
            protocol: "HTTP",
          },
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "if (pm.response.code === 201) {",
                  "  const j = pm.response.json();",
                  "  if (j.id) pm.collectionVariables.set('proxyId', j.id);",
                  "}",
                ],
              },
            },
          ],
        }),
        req("Patch Proxy", "PATCH", "/api/v1/platform/proxies/{{proxyId}}", {
          body: { status: "AVAILABLE" },
        }),
        req("Crawler Status", "GET", "/api/v1/platform/crawler"),
        req("Crawler Run", "POST", "/api/v1/platform/crawler/run", {
          body: {},
        }),
      ],
    },
    {
      name: "Platform — Creators",
      item: [
        req("List Platform Creators", "GET", "/api/v1/platform/creators"),
        req("Create Platform Creator", "POST", "/api/v1/platform/creators", {
          body: {
            organizationId: "{{orgId}}",
            handle: "plat_creator_{{$timestamp}}",
            region: "US",
          },
        }),
        req("Patch Platform Creator", "PATCH", "/api/v1/platform/creators/{{creatorId}}", {
          body: { stage: "ACTIVE" },
        }),
      ],
    },
    {
      name: "Platform — Discovery",
      item: [
        req("List Discovery Index", "GET", "/api/v1/platform/discovery?page=1&pageSize=20"),
        req("Create Discovery Profile", "POST", "/api/v1/platform/discovery", {
          body: {
            handle: "disc_{{$timestamp}}",
            displayName: "Discovery Creator",
            region: "US",
            followerCount: 10000,
          },
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: [
                  "if (pm.response.code === 201) {",
                  "  const j = pm.response.json();",
                  "  if (j.id) pm.collectionVariables.set('discoveryId', j.id);",
                  "}",
                ],
              },
            },
          ],
        }),
        req("Import Discovery Profiles", "POST", "/api/v1/platform/discovery/import", {
          body: {
            profiles: [
              { handle: "import_a", region: "US", followerCount: 1000 },
              { handle: "import_b", region: "UK", followerCount: 2000 },
            ],
          },
        }),
        req("TikTok Discovery Status", "GET", "/api/v1/platform/discovery/tiktok/status"),
        req("TikTok Discovery Sync", "POST", "/api/v1/platform/discovery/tiktok/sync", {
          body: {
            maxPages: 2,
            pageSize: 20,
            keyword: null,
            sync: false,
          },
        }),
      ],
    },
    {
      name: "Platform — Navigation Admin",
      item: [
        req("Get Platform Navigation", "GET", "/api/v1/platform/navigation"),
        req("Create Nav Item", "POST", "/api/v1/platform/navigation/items", {
          body: {
            sectionId: "{{navSectionId}}",
            key: "custom_{{$timestamp}}",
            label: "Custom",
            href: "/home",
            icon: "Home",
            sortOrder: 99,
          },
        }),
        req("Patch Nav Item", "PATCH", "/api/v1/platform/navigation/items/{{navItemId}}", {
          body: { label: "Custom Updated" },
        }),
      ],
    },
  ],
};

const outDir = path.join("postman");
fs.writeFileSync(
  path.join(outDir, "Tiksly-Affiliate-Tool.postman_collection.json"),
  JSON.stringify(collection, null, 2)
);

const env = {
  id: "tiksly-affiliate-env-local",
  name: "Tiksly — Local",
  values: [
    { key: "baseUrl", value: "http://localhost:4000", type: "default", enabled: true },
    { key: "accessToken", value: "", type: "secret", enabled: true },
    { key: "refreshToken", value: "", type: "secret", enabled: true },
    { key: "shopId", value: "", type: "default", enabled: true },
    { key: "inviteToken", value: "", type: "secret", enabled: true },
    { key: "planCode", value: "starter", type: "default", enabled: true },
    { key: "creatorId", value: "", type: "default", enabled: true },
    { key: "listId", value: "", type: "default", enabled: true },
    { key: "campaignId", value: "", type: "default", enabled: true },
    { key: "templateId", value: "", type: "default", enabled: true },
    { key: "discoveryId", value: "", type: "default", enabled: true },
    { key: "orgId", value: "", type: "default", enabled: true },
    { key: "staffId", value: "", type: "default", enabled: true },
    { key: "proxyId", value: "", type: "default", enabled: true },
    { key: "navItemId", value: "", type: "default", enabled: true },
    { key: "navSectionId", value: "", type: "default", enabled: true },
    { key: "resetToken", value: "", type: "secret", enabled: true },
  ],
  _postman_variable_scope: "environment",
};
fs.writeFileSync(
  path.join(outDir, "Tiksly.environment.json"),
  JSON.stringify(env, null, 2)
);

function countItems(items) {
  let n = 0;
  for (const it of items) {
    if (it.item) n += countItems(it.item);
    else n += 1;
  }
  return n;
}
console.log("requests:", countItems(collection.item));
