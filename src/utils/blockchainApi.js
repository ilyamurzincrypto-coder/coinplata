// src/utils/blockchainApi.js
// Стабы fetcher'ов incoming crypto transactions. Сигнатуры сделаны так же как
// в реальных explorer API, чтобы можно было заменить на продовую реализацию
// без изменений вызывающего кода.
//
// Реальные API:
//   TRC20:  https://api.trongrid.io/v1/accounts/{address}/transactions/trc20
//           (параметр `min_timestamp` или `fingerprint` как cursor)
//   ERC20:  https://api.etherscan.io/api?module=account&action=tokentx
//           &address={address}&startblock={lastCheckedBlock}&sort=asc
//
// Возвращаемый shape:
//   { transactions: IncomingTx[], lastBlock: number | null }
//
// IncomingTx:
//   { txHash, from_address, to_address, amount, tokenSymbol, blockNumber, timestamp }
//
// Текущая реализация: ВСЕГДА возвращает пустой список. Реальные данные приходят
// только через `simulateIncoming()` в MonitoringProvider — это даёт честный
// демо-флоу без блокчейн-бэкенда. Переключение на настоящие API — замена
// тел этих функций на `fetch(...)`.

export async function fetchIncomingTrc20(address, lastCheckedBlock = 0) {
  // TODO: заменить на fetch к TronGrid, например:
  //   const r = await fetch(`https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?only_to=true&min_timestamp=${since}`);
  //   const data = await r.json();
  //   return {
  //     transactions: data.data.map((t) => ({
  //       txHash: t.transaction_id,
  //       from_address: t.from,
  //       to_address: t.to,
  //       amount: Number(t.value) / 10 ** t.token_info.decimals,
  //       tokenSymbol: t.token_info.symbol,
  //       blockNumber: t.block,
  //       timestamp: new Date(t.block_timestamp).toISOString(),
  //     })),
  //     lastBlock: data.data[data.data.length - 1]?.block || lastCheckedBlock,
  //   };
  return { transactions: [], lastBlock: lastCheckedBlock };
}

export async function fetchIncomingErc20(address, lastCheckedBlock = 0) {
  // TODO: заменить на fetch к Etherscan:
  //   const r = await fetch(`https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=${lastCheckedBlock}&sort=asc&apikey=...`);
  //   Etherscan возвращает { status, result: [...] }.
  return { transactions: [], lastBlock: lastCheckedBlock };
}

// Хелпер: подобрать правильный fetcher по network-строке.
export function fetcherForNetwork(network) {
  switch ((network || "").toUpperCase()) {
    case "TRC20":
      return fetchIncomingTrc20;
    case "ERC20":
      return fetchIncomingErc20;
    default:
      return null;
  }
}
