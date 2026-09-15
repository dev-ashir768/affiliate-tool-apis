import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/lib/password.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import { createApp } from "../../src/app.js";
import {
  acceptInvite,
  createInvite,
  getCurrent,
  listMembers,
  patchCurrent,
} from "../../src/modules/orgs/orgs.service.js";
import { redis } from "../../src/lib/redis.js";

describe("orgs invites", () => {
  const suffix = Date.now();
  const ownerEmail = `org_owner_${suffix}@test.com`;
  const inviteEmail = `va_${suffix}@test.com`;
  const existingInviteeEmail = `existing_${suffix}@test.com`;
  const realUserNoAuthEmail = `real_noauth_${suffix}@test.com`;
  const roomyOwnerEmail = `roomy_owner_${suffix}@test.com`;

  let limitedOrgId = "";
  let limitedOwnerId = "";
  let roomyOrgId = "";
  let roomyOwnerId = "";
  let planId = "";
  const app = createApp();

  beforeAll(async () => {
    const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
    planId = free.id;

    const owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: await hashPassword("Secret123!"),
        name: "Owner",
      },
    });
    limitedOwnerId = owner.id;

    const limitedOrg = await prisma.organization.create({
      data: {
        name: "Seat Limited Org",
        slug: `seat-limited-${suffix}`,
        planId,
        seatLimit: 1,
        shopLimit: 0,
        dailyInviteQuota: 0,
      },
    });
    limitedOrgId = limitedOrg.id;

    await prisma.membership.create({
      data: {
        userId: owner.id,
        organizationId: limitedOrg.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    const roomyOwner = await prisma.user.create({
      data: {
        email: roomyOwnerEmail,
        passwordHash: await hashPassword("Secret123!"),
        name: "Roomy Owner",
      },
    });
    roomyOwnerId = roomyOwner.id;

    const roomyOrg = await prisma.organization.create({
      data: {
        name: "Roomy Org",
        slug: `roomy-${suffix}`,
        planId,
        seatLimit: 5,
        shopLimit: 0,
        dailyInviteQuota: 10,
      },
    });
    roomyOrgId = roomyOrg.id;

    await prisma.membership.create({
      data: {
        userId: roomyOwner.id,
        organizationId: roomyOrg.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
  }, 60000);

  afterAll(async () => {
    try {
      const emails = [
        ownerEmail,
        inviteEmail,
        existingInviteeEmail,
        realUserNoAuthEmail,
        roomyOwnerEmail,
        `expired_stub_${suffix}@test.com`,
        `http_invite_${suffix}@test.com`,
      ];
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
      });
      const userIds = users.map((u) => u.id);
      const memberships = userIds.length
        ? await prisma.membership.findMany({
            where: {
              OR: [
                { userId: { in: userIds } },
                {
                  organizationId: {
                    in: [limitedOrgId, roomyOrgId].filter(Boolean),
                  },
                },
              ],
            },
          })
        : [];
      const memberUserIds = memberships.map((m) => m.userId);
      const orgIds = [
        ...new Set([
          ...memberships.map((m) => m.organizationId),
          limitedOrgId,
          roomyOrgId,
        ].filter(Boolean)),
      ];
      if (orgIds.length) {
        await prisma.membership.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
      }
      const allUserIds = [...new Set([...userIds, ...memberUserIds])];
      if (allUserIds.length) {
        await prisma.refreshToken.deleteMany({
          where: { userId: { in: allUserIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
      }
      if (orgIds.length) {
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
    } finally {
      await prisma.$disconnect();
      if (redis.status === "ready") await redis.quit();
    }
  });

  it("inviting beyond seatLimit throws PLAN_LIMIT", async () => {
    await expect(
      createInvite({
        organizationId: limitedOrgId,
        actorUserId: limitedOwnerId,
        email: inviteEmail,
        role: "MEMBER",
      })
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
  }, 60000);

  it("creates invite and accepts for new user with password+name", async () => {
    const created = await createInvite({
      organizationId: roomyOrgId,
      actorUserId: roomyOwnerId,
      email: inviteEmail,
      role: "MEMBER",
    });
    expect(created.inviteToken).toBeTruthy();
    expect(created.membership.status).toBe("INVITED");

    const accepted = await acceptInvite({
      token: created.inviteToken,
      password: "Welcome123!",
      name: "VA User",
    });
    expect(accepted.membership.status).toBe("ACTIVE");
    expect(accepted.user.name).toBe("VA User");
    expect(accepted.user.email).toBe(inviteEmail);
  }, 60000);

  it("accepts invite when existing user is authenticated as that email", async () => {
    const invitee = await prisma.user.create({
      data: {
        email: existingInviteeEmail,
        passwordHash: await hashPassword("Secret123!"),
        name: "Existing",
      },
    });

    const created = await createInvite({
      organizationId: roomyOrgId,
      actorUserId: roomyOwnerId,
      email: existingInviteeEmail,
      role: "ADMIN",
    });

    const accepted = await acceptInvite({
      token: created.inviteToken,
      actorUserId: invitee.id,
    });
    expect(accepted.membership.status).toBe("ACTIVE");
    expect(accepted.membership.role).toBe("ADMIN");
  }, 60000);

  it("rejects password+name accept for existing real users without auth", async () => {
    const originalPassword = "OriginalPass1!";
    const realUser = await prisma.user.create({
      data: {
        email: realUserNoAuthEmail,
        passwordHash: await hashPassword(originalPassword),
        name: "Real User",
      },
    });
    const originalHash = realUser.passwordHash;

    // Real users have an ACTIVE membership elsewhere (or any ACTIVE) — not stubs
    const otherOrg = await prisma.organization.create({
      data: {
        name: "Other Org",
        slug: `other-${suffix}`,
        planId,
        seatLimit: 5,
        shopLimit: 0,
        dailyInviteQuota: 0,
      },
    });
    await prisma.membership.create({
      data: {
        userId: realUser.id,
        organizationId: otherOrg.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    const created = await createInvite({
      organizationId: roomyOrgId,
      actorUserId: roomyOwnerId,
      email: realUserNoAuthEmail,
      role: "MEMBER",
    });

    await expect(
      acceptInvite({
        token: created.inviteToken,
        password: "HackedPass9!",
        name: "Hacker",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: realUser.id },
    });
    expect(unchanged.passwordHash).toBe(originalHash);
    expect(unchanged.name).toBe("Real User");

    const membership = await prisma.membership.findUniqueOrThrow({
      where: {
        userId_organizationId: {
          userId: realUser.id,
          organizationId: roomyOrgId,
        },
      },
    });
    expect(membership.status).toBe("INVITED");

    await prisma.membership.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  }, 60000);

  it("re-invites when prior invite expired and register cleans expired stub", async () => {
    const expiredEmail = `expired_stub_${suffix}@test.com`;
    const first = await createInvite({
      organizationId: roomyOrgId,
      actorUserId: roomyOwnerId,
      email: expiredEmail,
      role: "MEMBER",
    });

    await prisma.membership.update({
      where: { id: first.membership.id },
      data: { inviteExpiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(
      acceptInvite({
        token: first.inviteToken,
        password: "Welcome123!",
        name: "Too Late",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const second = await createInvite({
      organizationId: roomyOrgId,
      actorUserId: roomyOwnerId,
      email: expiredEmail,
      role: "ADMIN",
    });
    expect(second.inviteToken).toBeTruthy();
    expect(second.inviteToken).not.toBe(first.inviteToken);
    expect(second.membership.role).toBe("ADMIN");

    // Expire again and register should adopt the email
    await prisma.membership.updateMany({
      where: {
        organizationId: roomyOrgId,
        user: { email: expiredEmail },
        status: "INVITED",
      },
      data: { inviteExpiresAt: new Date(Date.now() - 60_000) },
    });

    const { register } = await import("../../src/modules/auth/auth.service.js");
    const registered = await register({
      email: expiredEmail,
      password: "FreshPass1!",
      name: "Fresh User",
      organizationName: `Fresh Org ${suffix}`,
    });
    expect(registered.user.email).toBe(expiredEmail);
    expect(registered.user.name).toBe("Fresh User");
  }, 60000);

  it("getCurrent / patchCurrent / listMembers work", async () => {
    const current = await getCurrent(roomyOrgId);
    expect(current.id).toBe(roomyOrgId);
    expect(current.plan.code).toBe("free");

    const patched = await patchCurrent(roomyOrgId, { name: "Roomy Renamed" });
    expect(patched.name).toBe("Roomy Renamed");

    const members = await listMembers(roomyOrgId);
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(members.some((m) => m.role === "OWNER")).toBe(true);
  }, 60000);

  it("HTTP: invite requires OWNER/ADMIN and returns raw token", async () => {
    const accessToken = await signAccessToken({
      sub: roomyOwnerId,
      orgId: roomyOrgId,
      role: "OWNER",
    });

    const email = `http_invite_${suffix}@test.com`;
    const res = await request(app)
      .post("/api/v1/orgs/current/invites")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email, role: "MEMBER" });

    expect(res.status).toBe(201);
    expect(res.body.inviteToken).toBeTruthy();

    const acceptRes = await request(app)
      .post(`/api/v1/orgs/invites/${res.body.inviteToken}/accept`)
      .send({ password: "Welcome123!", name: "HTTP Invitee" });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.membership.status).toBe("ACTIVE");

    const membersRes = await request(app)
      .get("/api/v1/orgs/current/members")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(membersRes.status).toBe(200);
    expect(
      membersRes.body.members.some(
        (m: { user: { email: string } }) => m.user.email === email
      )
    ).toBe(true);
  }, 60000);
});
