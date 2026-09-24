import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore, AuthError } from "../server/auth";

test("scrypt register/login roundtrip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crush-auth-"));
  try {
    const store = new AuthStore(dir);
    const reg = await store.register("测试User_1", "secret99");
    assert.equal(reg.user.username, "测试User_1");
    assert.equal(reg.user.role, "user");
    assert.ok(reg.token.length >= 32);
    const byToken = await store.getUserByToken(reg.token);
    assert.equal(byToken?.id, reg.user.id);

    const login = await store.login("测试user_1", "secret99"); // case-insensitive
    assert.equal(login.user.id, reg.user.id);

    await assert.rejects(
      () => store.login("测试User_1", "wrongpw"),
      (e: unknown) => e instanceof AuthError && e.status === 401,
    );
    await assert.rejects(
      () => store.register("测试User_1", "another1"),
      (e: unknown) => e instanceof AuthError && e.status === 409,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seedAdmin creates admin from env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crush-auth-admin-"));
  const prevU = process.env.ADMIN_USERNAME;
  const prevP = process.env.ADMIN_PASSWORD;
  try {
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "AdminPass123456";
    const store = new AuthStore(dir);
    const seeded = await store.seedAdmin();
    assert.ok(seeded);
    assert.equal(seeded!.role, "admin");
    const login = await store.login("admin", "AdminPass123456");
    assert.equal(login.user.role, "admin");
  } finally {
    if (prevU === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = prevU;
    if (prevP === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevP;
    await rm(dir, { recursive: true, force: true });
  }
});
