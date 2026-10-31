import { moment as bundledMoment } from "obsidian";
import type momentType from "moment";

// Obsidian 1.13's declaration uses a namespace import; the host exports the
// callable Moment factory. Keep that upstream typing workaround in one place.
export const moment = bundledMoment as unknown as typeof momentType;
