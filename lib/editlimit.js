export const MAX_EDITS = 3;

export function canEdit(editCount) {
  return (editCount || 0) < MAX_EDITS;
}

export function canDelete(editCount) {
  return (editCount || 0) < MAX_EDITS;
}

export function remainingEdits(editCount) {
  return Math.max(0, MAX_EDITS - (editCount || 0));
}
