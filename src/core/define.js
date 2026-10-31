// Helpers for describing node parameters.
export const num = (id, label, def, extra = {}) => ({ id, label, default: def, step: 0.01, ...extra });
export const select = (id, label, def, options) => ({ id, label, default: def, select: options });
