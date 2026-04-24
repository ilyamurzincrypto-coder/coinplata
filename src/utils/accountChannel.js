// src/utils/accountChannel.js
// Резолвит channel для account. Новые аккаунты создаются с channelId в явном виде
// (через AddAccountModal). Legacy-аккаунты без channelId мапятся по (currency, type, network).

export function resolveAccountChannel(account, channels) {
  if (!account || !channels) return null;
  if (account.channelId) {
    return channels.find((c) => c.id === account.channelId) || null;
  }
  // fallback: derivation
  if (account.type === "crypto") {
    return (
      channels.find(
        (c) =>
          c.currencyCode === account.currency &&
          c.kind === "network" &&
          (account.network ? (c.network || "").toUpperCase() === account.network.toUpperCase() : true)
      ) ||
      channels.find((c) => c.currencyCode === account.currency && c.kind === "network") ||
      null
    );
  }
  // fiat: match by currency + kind (cash / bank / sepa / swift)
  return (
    channels.find((c) => c.currencyCode === account.currency && c.kind === account.type) || null
  );
}

// Человекочитаемая "подпись" канала: TRC20 / Cash / Bank / SEPA / …
export function channelShortLabel(channel) {
  if (!channel) return "—";
  if (channel.kind === "network") return channel.network || "Network";
  if (channel.kind === "cash") return "Cash";
  if (channel.kind === "bank") return "Bank";
  if (channel.kind === "sepa") return "SEPA";
  if (channel.kind === "swift") return "SWIFT";
  if (channel.kind === "qr") return "QR";
  return channel.kind;
}
