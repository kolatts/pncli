import { describe, it, expect } from 'vitest';
import { guessMimeType } from './mime.js';

describe('guessMimeType', () => {
  it('returns correct MIME type for image extensions', () => {
    expect(guessMimeType('photo.jpg')).toBe('image/jpeg');
    expect(guessMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(guessMimeType('icon.png')).toBe('image/png');
    expect(guessMimeType('animation.gif')).toBe('image/gif');
    expect(guessMimeType('logo.svg')).toBe('image/svg+xml');
  });

  it('returns correct MIME type for document extensions', () => {
    expect(guessMimeType('document.pdf')).toBe('application/pdf');
    expect(guessMimeType('notes.txt')).toBe('text/plain');
    expect(guessMimeType('app.log')).toBe('text/plain');
    expect(guessMimeType('data.csv')).toBe('text/csv');
    expect(guessMimeType('config.json')).toBe('application/json');
    expect(guessMimeType('data.xml')).toBe('application/xml');
    expect(guessMimeType('readme.md')).toBe('text/markdown');
    expect(guessMimeType('page.html')).toBe('text/html');
    expect(guessMimeType('page.htm')).toBe('text/html');
  });

  it('returns correct MIME type for Microsoft Office extensions', () => {
    expect(guessMimeType('report.doc')).toBe('application/msword');
    expect(guessMimeType('report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(guessMimeType('spreadsheet.xls')).toBe('application/vnd.ms-excel');
    expect(guessMimeType('spreadsheet.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('returns correct MIME type for archive extensions', () => {
    expect(guessMimeType('archive.zip')).toBe('application/zip');
    expect(guessMimeType('archive.tar')).toBe('application/x-tar');
    expect(guessMimeType('archive.gz')).toBe('application/gzip');
  });

  it('is case-insensitive', () => {
    expect(guessMimeType('PHOTO.JPG')).toBe('image/jpeg');
    expect(guessMimeType('Photo.PNG')).toBe('image/png');
    expect(guessMimeType('Document.PDF')).toBe('application/pdf');
  });

  it('works with absolute paths', () => {
    expect(guessMimeType('/home/user/documents/report.pdf')).toBe('application/pdf');
    expect(guessMimeType('/var/log/app.log')).toBe('text/plain');
  });

  it('works with relative paths', () => {
    expect(guessMimeType('./photos/vacation.jpg')).toBe('image/jpeg');
    expect(guessMimeType('../../docs/readme.md')).toBe('text/markdown');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(guessMimeType('file.unknown')).toBe('application/octet-stream');
    expect(guessMimeType('file.xyz')).toBe('application/octet-stream');
    expect(guessMimeType('file.custom')).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for files without extensions', () => {
    expect(guessMimeType('Makefile')).toBe('application/octet-stream');
    expect(guessMimeType('README')).toBe('application/octet-stream');
  });
});
