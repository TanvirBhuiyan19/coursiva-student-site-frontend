/** A lead form id as it may appear in a URL (`frm_` + a lowercase ULID; anything id-shaped is passed to the API). */
export const isFormId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
