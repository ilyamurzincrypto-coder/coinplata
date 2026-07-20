// walletsCsv.test.js — парсер импорта кошельков + дубли.
import { describe, it, expect } from "vitest";
import { parseWalletsCsv, existingWalletKeys, isDuplicateRow } from "./walletsCsv.js";

describe("parseWalletsCsv", () => {
  it("парсит с заголовком, нормализует сеть в lowercase", () => {
    const csv = `name,address,network
W88 Mark,TMarkAddr111,TRC20
W89 Lara,0xLaraAddr222,ERC20`;
    const { rows, errors } = parseWalletsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "W88 Mark", address: "TMarkAddr111", network: "trc20" });
    expect(rows[1].network).toBe("erc20");
  });

  it("работает без заголовка", () => {
    const { rows } = parseWalletsCsv("W92,TAddr,trc20");
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe("TAddr");
  });

  it("неизвестная сеть → ошибка, строка не попадает", () => {
    const { rows, errors } = parseWalletsCsv("W,addr,SOLANA");
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toMatch(/неизвестная сеть/);
  });

  it("нет адреса/сети → ошибка", () => {
    const { errors } = parseWalletsCsv("OnlyName");
    expect(errors[0].message).toMatch(/нужны address и network/);
  });

  it("дубль внутри файла помечается и пропускается", () => {
    const csv = `W1,TAddr,trc20
W2,taddr,TRC20`;
    const { rows, errors } = parseWalletsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors.some((e) => /дубль в файле/.test(e.message))).toBe(true);
  });

  it("пустые строки игнорируются", () => {
    const { rows } = parseWalletsCsv("\n\nW,TAddr,trc20\n\n");
    expect(rows).toHaveLength(1);
  });

  it("BEP20 распознаётся как сеть", () => {
    const { rows, errors } = parseWalletsCsv("Lara,0x8cf4f979831c8585F6eF6867E8D70c2e346455e4,BEP20");
    expect(errors).toHaveLength(0);
    expect(rows[0].network).toBe("bep20");
  });

  it("один адрес в ERC20 и BEP20 = ДВЕ строки (ключ по network+address)", () => {
    const addr = "0x8cf4f979831c8585F6eF6867E8D70c2e346455e4";
    const { rows, errors } = parseWalletsCsv(`Lara,${addr},ERC20\nLara,${addr},BEP20`);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.network).sort()).toEqual(["bep20", "erc20"]);
  });
});

describe("сопоставление с существующими", () => {
  const accounts = [
    { address: "TMarkAddr111", network: "TRC20" },
    { address: "0xLara", network: "ERC20" },
    { address: null, network: null },
  ];
  it("existingWalletKeys собирает ключи по network:address (lowercase)", () => {
    const keys = existingWalletKeys(accounts);
    expect(keys.has("trc20:tmarkaddr111")).toBe(true);
    expect(keys.size).toBe(2);
  });
  it("isDuplicateRow ловит существующий (регистронезависимо)", () => {
    const keys = existingWalletKeys(accounts);
    expect(isDuplicateRow({ network: "trc20", address: "TMARKADDR111" }, keys)).toBe(true);
    expect(isDuplicateRow({ network: "trc20", address: "TNew" }, keys)).toBe(false);
  });

  it("BEP20 с адресом существующего ERC20-счёта — НЕ дубль (сеть другая)", () => {
    const keys = existingWalletKeys([{ address: "0xLara", network: "ERC20" }]);
    expect(isDuplicateRow({ network: "erc20", address: "0xLara" }, keys)).toBe(true);
    expect(isDuplicateRow({ network: "bep20", address: "0xLara" }, keys)).toBe(false);
  });
});
