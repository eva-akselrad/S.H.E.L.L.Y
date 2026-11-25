// jsfive ships no types. Only what the GLM reader uses.
declare module "jsfive" {
  export interface Dataset {
    value: ArrayLike<number>;
    shape: number[];
    dtype: string;
  }
  export class File {
    constructor(buffer: ArrayBuffer, name?: string);
    keys: string[];
    get(path: string): Dataset | null;
  }
}
