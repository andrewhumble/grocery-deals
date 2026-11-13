import { rebuildDealIndex } from "../src/lib/retrieval/index";

void (async () => {
  const status = await rebuildDealIndex();
  console.log(JSON.stringify(status, null, 2));
})();
