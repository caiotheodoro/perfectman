import type { UploadedFile } from "@perfectman/shared";

/** Presets and editable markdown share one selection, throughout the flow. */
export type Selection = {
  /** Null once the files have been edited away from any preset. */
  presetId: string | null;
  files: UploadedFile[];
};
