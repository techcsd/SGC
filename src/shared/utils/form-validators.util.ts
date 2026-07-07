import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Group validator: value at `maxKey` must be >= value at `minKey` (nulls pass). */
export function maxGteMin(minKey: string, maxKey: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const min = group.get(minKey)?.value;
    const max = group.get(maxKey)?.value;
    if (min == null || max == null || max === '') return null;
    return Number(max) >= Number(min) ? null : { maxLtMin: true };
  };
}

/** Group validator: time at `endKey` must be after time at `startKey` (either null passes). */
export function endTimeAfterStart(startKey: string, endKey: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const start = group.get(startKey)?.value;
    const end = group.get(endKey)?.value;
    if (!start || !end) return null;
    return end > start ? null : { endBeforeStart: true };
  };
}
