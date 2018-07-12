import { BaseModel } from 'app/core/models/base-model';

/**
 * Representation of a motion category. Has the nested property "File"
 * @ignore
 */
export class Category extends BaseModel {
    protected _collectionString: string;
    id: number;
    name: string;
    prefix: string;

    constructor(id?: number, name?: string, prefix?: string) {
        super();
        this._collectionString = 'motions/category';
        this.id = id;
        this.name = name;
        this.prefix = prefix;
    }
}
