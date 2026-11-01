import { describe, it, expect } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';

describe('ClinicDatabase Computed Slots & Availability', () => {
  it('should initialize successfully', () => {
    const db = new ClinicDatabase();
    expect(db).toBeDefined();
  });
});
