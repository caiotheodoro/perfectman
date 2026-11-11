/** Page furniture of script PDFs and copied scripts: continuation marks, (MORE), watermarks. */
export const isBoilerplate = (text: string): boolean => /^\(?\s*(?:cont(?:inued|'d|d|inua(?:ndo)?)?\.?(?:\.\.\.)?|more|continua\.{0,3}|\.\.\.continuando:?\s*\d*)\s*\)?\.?:?\s*\d*$/i.test(text.trim()) || /©|privileged and confidential|all rights reserved|property of/i.test(text);
