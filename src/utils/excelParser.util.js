// src/utils/excelParser.util.js
import XLSX from 'xlsx';
import { AppError } from './appError.js';

export const parseStudentsExcel = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  if (!rows || rows.length === 0) {
    throw new AppError('Excel file is empty', 400);
  }

  const students = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    try {
      if (!row.full_name?.trim() || !row.email?.trim() || !row.password || !row.dept_code?.trim() || !row.batch_year || !row.phone_number) {
        errors.push(`Row ${rowNum}: Missing required fields`);
        continue;
      }

      if (row.password.length < 6) {
        errors.push(`Row ${rowNum}: Password too short (min 6 chars)`);
        continue;
      }

      if (row.phone_number && !/^\d{10}$/.test(row.phone_number.toString())) {
        errors.push(`Row ${rowNum}: Invalid phone number (must be 10 digits)`);
        continue;
      }

      students.push({
        full_name: row.full_name.trim(),
        email: row.email.trim().toLowerCase(),
        password: row.password,
        phone_number: row.phone_number,
        dept_code: row.dept_code.trim().toUpperCase(),
        batch_year: row.batch_year.toString(),
        tutor_id: row.tutor_id || null
      });
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new AppError(`Excel validation failed:\n${errors.join('\n')}`, 400);
  }

  return students;
};

export const parseStaffExcel = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  if (!rows || rows.length === 0) {
    throw new AppError('Excel file is empty', 400);
  }

  const staff = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    try {
      if (!row.full_name?.trim() || !row.email?.trim() || !row.password || !row.dept_code?.trim() || !row.phone_number) {
        errors.push(`Row ${rowNum}: Missing required fields`);
        continue;
      }

      if (row.password.length < 6) {
        errors.push(`Row ${rowNum}: Password too short (min 6 chars)`);
        continue;
      }

      if (row.phone_number && !/^\d{10}$/.test(row.phone_number.toString())) {
        errors.push(`Row ${rowNum}: Invalid phone number (must be 10 digits)`);
        continue;
      }

      staff.push({
        full_name: row.full_name.trim(),
        email: row.email.trim().toLowerCase(),
        password: row.password,
        phone_number: row.phone_number,
        dept_code: row.dept_code.trim().toUpperCase()
      });
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new AppError(`Excel validation failed:\n${errors.join('\n')}`, 400);
  }

  return staff;
};