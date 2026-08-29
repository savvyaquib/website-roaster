import { describe, expect, it } from "vitest";

import {
  classifyIpLiteral,
  classifyIpv4,
  classifyIpv6,
  parseIpv4,
  parseIpv6,
} from "./ip";

describe("parseIpv4", () => {
  it("parses a dotted-decimal address", () => {
    expect(parseIpv4("192.168.1.1")).toEqual([192, 168, 1, 1]);
    expect(parseIpv4("0.0.0.0")).toEqual([0, 0, 0, 0]);
    expect(parseIpv4("255.255.255.255")).toEqual([255, 255, 255, 255]);
  });

  it.each([
    ["too few parts", "127.0.0"],
    ["too many parts", "1.2.3.4.5"],
    ["an octet above 255", "256.0.0.1"],
    ["a leading zero", "010.0.0.1"],
    ["an empty octet", "127..0.1"],
    ["hex", "0x7f.0.0.1"],
    ["a hostname", "example.com"],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(parseIpv4(value)).toBeNull();
  });

  it("is strict on purpose, because the URL parser already normalised the host", () => {
    // http://0177.0.0.1/ reaches us as 127.0.0.1; accepting octal here as well
    // would mean two components disagreeing about what an address is.
    expect(parseIpv4("0177.0.0.1")).toBeNull();
  });
});

describe("classifyIpv4", () => {
  it.each([
    ["loopback", "127.0.0.1", "loopback"],
    ["loopback across the whole /8", "127.255.255.254", "loopback"],
    ["private 10/8", "10.0.0.1", "private_network"],
    ["private 172.16/12", "172.16.0.1", "private_network"],
    ["private 172.31/12 upper bound", "172.31.255.255", "private_network"],
    ["private 192.168/16", "192.168.1.1", "private_network"],
    ["link-local", "169.254.1.1", "link_local"],
    ["AWS/GCP/Azure metadata", "169.254.169.254", "metadata_endpoint"],
    ["Alibaba metadata", "100.100.100.200", "metadata_endpoint"],
    ["unspecified", "0.0.0.0", "unspecified_address"],
    ["carrier-grade NAT", "100.64.0.1", "shared_address_space"],
    ["multicast", "224.0.0.1", "multicast_address"],
    ["broadcast", "255.255.255.255", "reserved_address"],
    ["TEST-NET-1", "192.0.2.1", "reserved_address"],
    ["TEST-NET-2", "198.51.100.1", "reserved_address"],
    ["TEST-NET-3", "203.0.113.1", "reserved_address"],
    ["benchmarking", "198.18.0.1", "reserved_address"],
    ["6to4 relay anycast", "192.88.99.1", "reserved_address"],
  ])("blocks %s", (_label, address, expected) => {
    expect(classifyIpv4(parseIpv4(address)!)).toBe(expected);
  });

  it.each([
    ["a public address", "93.184.216.34"],
    ["a Google DNS resolver", "8.8.8.8"],
    ["just outside 172.16/12", "172.15.255.255"],
    ["just above 172.31/12", "172.32.0.1"],
    ["just outside 100.64/10", "100.128.0.1"],
    ["just outside link-local", "169.253.0.1"],
    ["a 1.x address", "1.1.1.1"],
  ])("allows %s", (_label, address) => {
    expect(classifyIpv4(parseIpv4(address)!)).toBeNull();
  });
});

describe("parseIpv6", () => {
  it("parses a full address", () => {
    expect(parseIpv6("2001:db8:0:0:0:0:0:1")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  });

  it("expands :: compression", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("fe80::1")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("accepts the bracketed form URL.hostname returns", () => {
    expect(parseIpv6("[::1]")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("parses an embedded IPv4 tail", () => {
    expect(parseIpv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });

  it.each([
    ["two compressions", "::1::2"],
    ["too many groups", "1:2:3:4:5:6:7:8:9"],
    ["too few groups without compression", "1:2:3"],
    ["a non-hex group", "gggg::1"],
    ["an over-long group", "12345::1"],
    ["a zone identifier", "fe80::1%eth0"],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(parseIpv6(value)).toBeNull();
  });

  it("requires :: to stand for at least one group", () => {
    expect(parseIpv6("1:2:3:4:5:6:7::8")).toBeNull();
  });
});

describe("classifyIpv6", () => {
  it.each([
    ["loopback", "::1", "loopback"],
    ["unspecified", "::", "unspecified_address"],
    ["link-local", "fe80::1", "link_local"],
    ["link-local upper bound", "febf::1", "link_local"],
    ["unique local fc00::/7", "fc00::1", "private_network"],
    ["unique local fd00::", "fd12:3456::1", "private_network"],
    ["multicast", "ff02::1", "multicast_address"],
    ["documentation", "2001:db8::1", "reserved_address"],
    ["discard prefix", "100::1", "reserved_address"],
    ["AWS IMDS over IPv6", "fd00:ec2::254", "metadata_endpoint"],
  ])("blocks %s", (_label, address, expected) => {
    expect(classifyIpv6(parseIpv6(address)!)).toBe(expected);
  });

  it("allows a public address", () => {
    expect(classifyIpv6(parseIpv6("2606:4700:4700::1111")!)).toBeNull();
  });

  describe("addresses that embed IPv4", () => {
    it("blocks IPv4-mapped loopback", () => {
      expect(classifyIpv6(parseIpv6("::ffff:127.0.0.1")!)).toBe("loopback");
    });

    it("blocks IPv4-mapped metadata, which is the obvious bypass attempt", () => {
      expect(classifyIpv6(parseIpv6("::ffff:169.254.169.254")!)).toBe(
        "metadata_endpoint",
      );
    });

    it("blocks IPv4-mapped private space", () => {
      expect(classifyIpv6(parseIpv6("::ffff:192.168.1.1")!)).toBe("private_network");
    });

    it("blocks NAT64-wrapped private space", () => {
      expect(classifyIpv6(parseIpv6("64:ff9b::10.0.0.1")!)).toBe("private_network");
    });

    it("blocks 6to4-wrapped private space", () => {
      // 2002:c0a8:0101:: embeds 192.168.1.1
      expect(classifyIpv6(parseIpv6("2002:c0a8:101::1")!)).toBe("private_network");
    });

    it("allows an IPv4-mapped public address", () => {
      expect(classifyIpv6(parseIpv6("::ffff:93.184.216.34")!)).toBeNull();
    });
  });
});

describe("classifyIpLiteral", () => {
  it("reports a non-IP hostname as such", () => {
    expect(classifyIpLiteral("example.com")).toEqual({ kind: "not-an-ip" });
  });

  it("classifies a bare IPv4 host", () => {
    expect(classifyIpLiteral("10.0.0.1")).toEqual({
      kind: "ip",
      reason: "private_network",
    });
  });

  it("classifies a bracketed IPv6 host", () => {
    expect(classifyIpLiteral("[::1]")).toEqual({ kind: "ip", reason: "loopback" });
  });

  it("allows a public IPv4 host", () => {
    expect(classifyIpLiteral("93.184.216.34")).toEqual({ kind: "ip", reason: null });
  });

  it("refuses a bracketed host it cannot parse rather than letting it through", () => {
    expect(classifyIpLiteral("[not-an-address]")).toEqual({
      kind: "ip",
      reason: "reserved_address",
    });
  });
});
