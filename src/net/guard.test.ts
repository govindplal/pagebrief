import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPublicUrl, isPrivateAddress, usesProxyEnv } from "./guard.ts";

test("isPrivateAddress covers loopback, private, link-local and mapped addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "[::1]", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "93.184.216.34", "2606:4700::1111", "::ffff:8.8.8.8"])
    assert.equal(isPrivateAddress(ip), false, ip);
});

test("assertPublicUrl refuses local targets, including disguised ones", async () => {
  const never = async () => {
    throw new Error("lookup should not run");
  };
  for (const url of ["http://localhost:3000/", "http://app.localhost/", "http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://[::1]:8080/", "http://169.254.169.254/latest/meta-data/"])
    await assert.rejects(assertPublicUrl(url, never), /refused to open .*--allow-private/, url);
  await assert.rejects(
    assertPublicUrl("http://intranet.example/", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }]),
    /resolves to 10\.0\.0\.5/,
  );
});

test("assertPublicUrl allows public targets and leaves unresolvable names to Chrome", async () => {
  await assertPublicUrl("https://example.com/", async () => [{ address: "93.184.216.34" }]);
  await assertPublicUrl("https://8.8.8.8/", async () => {
    throw new Error("lookup should not run");
  });
  await assertPublicUrl("https://nope.invalid/", async () => {
    throw new Error("ENOTFOUND");
  });
});

test("usesProxyEnv reads the standard proxy variables", () => {
  assert.equal(usesProxyEnv({}), false);
  assert.equal(usesProxyEnv({ HTTPS_PROXY: "http://127.0.0.1:8080" }), true);
  assert.equal(usesProxyEnv({ all_proxy: "socks5://10.0.0.1:1080" }), true);
});
