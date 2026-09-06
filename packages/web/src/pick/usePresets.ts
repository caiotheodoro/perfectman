/**
 * Presets come from the server, not the bundle, so adding a scene is dropping a
 * folder in `examples/presets/` rather than a rebuild.
 */
import { useEffect, useState } from "react";
import type { UploadedFile } from "@perfectman/shared";
import { listPresets } from "../api/client.js";

export type Preset = {
  id: string;
  title: string;
  blurb: string;
  cast?: string;
  files: UploadedFile[];
};

export type PresetLibrary = { casts: Preset[]; scenes: Preset[] };

export function usePresets(): { library: PresetLibrary; loading: boolean; error: string | null } {
  const [library, setLibrary] = useState<PresetLibrary>({ casts: [], scenes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listPresets()
      .then((next) => {
        if (live) setLibrary(next);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return { library, loading, error };
}
