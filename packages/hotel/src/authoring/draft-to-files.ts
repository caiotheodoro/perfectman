import { roomFiles } from "@perfectman/shared";
import type { RoomDraft, StoryDraft, UploadedFile } from "@perfectman/shared";

/**
 * A drafted story to the markdown the existing compiler reads: `roomFiles` in
 * @perfectman/shared, the same code the web beginner form uses. Scenario first,
 * then one persona file per character.
 */
export function draftToFiles(draft: StoryDraft | RoomDraft): UploadedFile[] {
  const { scenario, personas } = roomFiles(draft);
  return [scenario, ...personas];
}
