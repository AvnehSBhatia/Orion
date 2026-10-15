import { describe as describeReadable, expect as expectReadable, it as itReadable } from "vitest";
import { readable } from "./widgets";

describeReadable("readable", () => {
  itReadable("turns internal words into plain ones in titles", () => {
    expectReadable(readable("At risk nodes")).toBe("At risk work items");
    expectReadable(readable("total nodes")).toBe("Total work items");
    expectReadable(readable("Sources in the last hour")).toBe("Updates in the last hour");
    expectReadable(readable("Blocked marketing work")).toBe("Blocked marketing work");
  });
});
