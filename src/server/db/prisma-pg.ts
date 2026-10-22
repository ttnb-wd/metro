import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";

type PgAdapter = Awaited<ReturnType<PrismaPg["connect"]>>;
type PgTransaction = Awaited<ReturnType<PgAdapter["startTransaction"]>>;

// Prisma can fan out the relation reads of a single findUnique/findMany.
// Each transaction owns one pg connection, so schedule its SQL one at a time.
// Queries outside transactions continue to use the adapter's connection pool.
export function serializeTransaction(transaction: PgTransaction): PgTransaction {
  let pending: Promise<void> = Promise.resolve();
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const result = pending.then(work);
    // Preserve each rejection for its caller, but allow ROLLBACK to run after it.
    pending = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    provider: transaction.provider,
    adapterName: transaction.adapterName,
    options: transaction.options,
    queryRaw: query => run(() => transaction.queryRaw(query)),
    executeRaw: query => run(() => transaction.executeRaw(query)),
    commit: () => run(() => transaction.commit()),
    rollback: () => run(() => transaction.rollback()),
    ...(transaction.createSavepoint && {
      createSavepoint: (name: string) => run(() => transaction.createSavepoint!(name)),
    }),
    ...(transaction.rollbackToSavepoint && {
      rollbackToSavepoint: (name: string) => run(() => transaction.rollbackToSavepoint!(name)),
    }),
    ...(transaction.releaseSavepoint && {
      releaseSavepoint: (name: string) => run(() => transaction.releaseSavepoint!(name)),
    }),
  };
}

export class MetroPrismaPg extends PrismaPg {
  override async connect() {
    const adapter = await super.connect();
    const startTransaction = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async isolationLevel => serializeTransaction(await startTransaction(isolationLevel));
    return adapter;
  }
}
