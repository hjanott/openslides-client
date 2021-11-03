import {
    Component,
    ContentChildren,
    ElementRef,
    Input,
    OnInit,
    QueryList,
    TemplateRef,
    ViewEncapsulation
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSelectChange } from '@angular/material/select';
import { MatTab } from '@angular/material/tabs';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { TranslateService } from '@ngx-translate/core';
import { columnFactory, createDS, PblColumnDefinition, PblDataSource, PblNgridColumnSet } from '@pebula/ngrid';
import { BaseImportService, NewEntry, ValueLabelCombination } from 'app/core/ui-services/base-import.service';
import { ComponentServiceCollector } from 'app/core/ui-services/component-service-collector';
import { BaseModel } from 'app/shared/models/base/base-model';
import { BaseComponent } from 'app/site/base/components/base.component';
import { Observable } from 'rxjs';
import { auditTime, distinctUntilChanged, map } from 'rxjs/operators';

import { CsvMapping, ImportStepPhase } from '../../../core/ui-services/base-import.service';
import { ImportListFirstTabDirective } from './import-list-first-tab.directive';
import { ImportListLastTabDirective } from './import-list-last-tab.directive';

export type ImportListViewHeaderDefinition = PblColumnDefinition & HeaderDefinition;

interface HeaderDefinition {
    label: string;
    prop: string;
    isRequired?: boolean;
    isTableColumn?: boolean;
}

@Component({
    selector: `os-import-list-view`,
    templateUrl: `./import-list-view.component.html`,
    styleUrls: [`./import-list-view.component.scss`],
    encapsulation: ViewEncapsulation.None
})
export class ImportListViewComponent<M extends BaseModel> extends BaseComponent implements OnInit {
    @ContentChildren(ImportListFirstTabDirective, { read: MatTab })
    public importListFirstTabs: QueryList<MatTab>;

    @ContentChildren(ImportListLastTabDirective, { read: MatTab })
    public importListLastTabs: QueryList<MatTab>;

    @Input()
    public columns?: PblColumnDefinition[];

    @Input()
    public headerDefinition?: ImportListViewHeaderDefinition;

    @Input()
    public rowHeight = 50;

    @Input()
    public modelName = ``;

    @Input()
    public set importer(importer: BaseImportService<M>) {
        this._importer = importer;
        this.initTable();
        importer.errorEvent.subscribe(this.raiseError);
    }

    public get importer(): BaseImportService<M> {
        return this._importer;
    }

    private _importer: BaseImportService<M>;

    /**
     * Defines all necessary and optional fields, that a .csv-file has to contain.
     */
    @Input()
    public possibleFields: string[] = [];

    public get defaultColumns(): PblColumnDefinition[] {
        return [
            {
                label: ``,
                prop: `status`,
                minWidth: 25,
                width: `25px`,
                maxWidth: 25
            },
            {
                label: `#`,
                prop: `importTrackId`,
                minWidth: 25,
                maxWidth: 25
            }
        ];
    }

    public readonly Phase = ImportStepPhase;

    public get columnSet(): PblNgridColumnSet {
        return this._columnSet;
    }

    /**
     * Data source for ngrid
     */
    public vScrollDataSource: PblDataSource<NewEntry<M>>;

    /**
     * Switch that turns true if a file has been selected in the input
     */
    public hasFile: Observable<boolean>;

    /**
     * Currently selected encoding. Is set and changed by the config's available
     * encodings and user mat-select input
     */
    public selectedEncoding = `utf-8`;

    /**
     * indicator on which elements to display
     */
    public shown: 'all' | 'error' | 'noerror' = `all`;

    public get leftReceivedHeaders(): string[] {
        return this.importer.leftReceivedHeaders;
    }

    public get leftExpectedHeaders(): { [key: string]: string } {
        return this.importer.leftExpectedHeaders;
    }

    /**
     * @returns the amount of total item successfully parsed
     */
    public get totalCount(): number {
        return this.importer && this.hasFile ? this.importer.summary.total : null;
    }

    /**
     * @returns the encodings available and their labels
     */
    public get encodings(): ValueLabelCombination[] {
        return this.importer.encodings;
    }

    /**
     * @returns the available column separators and their labels
     */
    public get columnSeparators(): ValueLabelCombination[] {
        return this.importer.columnSeparators;
    }

    /**
     * @eturns the available text separators and their labels
     */
    public get textSeparators(): ValueLabelCombination[] {
        return this.importer.textSeparators;
    }

    /**
     * @returns the amount of import items that will be imported
     */
    public get newCount(): number {
        return this.importer && this.hasFile ? this.importer.summary.new : 0;
    }

    /**
     * @returns the number of import items that cannot be imported
     */
    public get nonImportableCount(): number {
        if (this.importer && this.hasFile) {
            return this.importer.summary.errors + this.importer.summary.duplicates;
        }
        return 0;
    }

    /**
     * @returns the number of import items that have been successfully imported
     */
    public get doneCount(): number {
        return this.importer && this.hasFile ? this.importer.summary.done : 0;
    }

    public get importPreviewLabel(): string {
        return `${this.modelName || `Models`} will be imported.`;
    }

    public get importDoneLabel(): string {
        return `${this.modelName || `Models`} have been imported.`;
    }

    public get importingStepsObservable(): Observable<any> {
        return this.importer.importStepsObservable;
    }

    public get requiredFields(): string[] {
        return this._requiredFields;
    }

    public headerValueMap = {};

    private _root = this.host.nativeElement;
    private _requiredFields: string[] = [];
    private _columnSet: PblNgridColumnSet | null = null;

    public constructor(
        componentServiceCollector: ComponentServiceCollector,
        protected translate: TranslateService,
        private host: ElementRef<HTMLElement>,
        private dialog: MatDialog
    ) {
        super(componentServiceCollector, translate);
    }

    /**
     * Starts with a clean preview (removing any previously existing import previews)
     */
    public ngOnInit(): void {
        this.importer.clearPreview();
        this._columnSet = this.createColumnSet();
        this._requiredFields = this.createRequiredFields();
        this.resetRowHeight();
    }

    /**
     * Triggers a change in the tab group: Clearing the preview selection
     */
    public onTabChange(): void {
        this.importer.clearPreview();
    }

    /**
     * Initializes the table
     */
    public initTable(): void {
        const newEntriesObservable = this.importer.getNewEntries();
        this.hasFile = newEntriesObservable.pipe(
            distinctUntilChanged(),
            auditTime(100),
            map(entries => entries.length > 0)
        );

        this.vScrollDataSource = createDS<NewEntry<M>>()
            .keepAlive()
            .onTrigger(() => newEntriesObservable)
            .create();

        this.setFilter();
    }

    public hasSeveralTabs(): boolean {
        return this.importListFirstTabs.length + this.importListLastTabs.length > 0;
    }

    /**
     * triggers the importer's onSelectFile after a file has been chosen
     */
    public onSelectFile(event: any): void {
        this.importer.onSelectFile(event);
    }

    /**
     * Triggers the importer's import
     *
     */
    public async doImport(): Promise<void> {
        await this.importer.doImport();
        this.setFilter();
    }

    /**
     * Updates and manually triggers the filter function.
     * See {@link hidden} for options
     * (changed from default mat-table filter)
     */
    public setFilter(): void {
        if (this.shown === `all`) {
            this.vScrollDataSource.setFilter();
        } else if (this.shown === `noerror`) {
            const noErrorFilter = (data: NewEntry<any>) => data.status === `done` || data.status !== `error`;

            this.vScrollDataSource.setFilter(noErrorFilter);
        } else if (this.shown === `error`) {
            const hasErrorFilter = (data: NewEntry<any>) =>
                data.status === `error` || !!data.errors.length || data.hasDuplicates;

            this.vScrollDataSource.setFilter(hasErrorFilter);
        }
    }

    /**
     * Get the appropiate css class for a row according to the import state
     *
     * @param row a newEntry object with a current status
     * @returns a css class name
     */
    public getStateClass(row: NewEntry<M>): string {
        switch (row.status) {
            case `done`:
                return `import-done import-decided`;
            case `error`:
                return `import-error`;
            default:
                return ``;
        }
    }

    /**
     * Get the icon for the action of the item
     * @param entry a newEntry object with a current status
     * @eturn the icon for the action of the item
     */
    public getActionIcon(entry: NewEntry<M>): string {
        switch (entry.status) {
            case `error`: // no import possible
                return `block`;
            case `new`:
                return ``;
            case `done`: // item has been imported
                return `done`;
            default:
                return `block`; // fallback: Error
        }
    }

    public getTooltip(value: string | CsvMapping[]): string {
        if (Array.isArray(value)) {
            return value.map(entry => entry.name).join(`, `);
        }
        return value;
    }

    public getErrorDescription(entry: NewEntry<M>): string {
        return entry.errors.map(error => _(this.getVerboseError(error))).join(`, `);
    }

    public isUnknown(headerKey: string): boolean {
        return !this.importer.headerValues[headerKey];
    }

    public onChangeUnknownHeaderKey(headerKey: string, value: string): void {
        this.headerValueMap[headerKey] = value;
        this.importer.setNewHeaderValue({ [headerKey]: value });
    }

    /**
     * A function to trigger the csv example download.
     */
    public downloadCsvExample(): void {
        this.importer.downloadCsvExample();
    }

    /**
     * Trigger for the column separator selection.
     *
     * @param event
     */
    public selectColSep(event: MatSelectChange): void {
        this.importer.columnSeparator = event.value;
        this.importer.refreshFile();
    }

    /**
     * Trigger for the column separator selection
     *
     * @param event
     */
    public selectTextSep(event: MatSelectChange): void {
        this.importer.textSeparator = event.value;
        this.importer.refreshFile();
    }

    /**
     * Trigger for the encoding selection
     *
     * @param event
     */
    public selectEncoding(event: MatSelectChange): void {
        this.importer.encoding = event.value;
        this.importer.refreshFile();
    }

    /**
     * Returns a descriptive string for an import error
     *
     * @param error The short string for the error as listed in the {@lilnk errorList}
     * @returns a predefined descriptive error string from the importer
     */
    public getVerboseError(error: string): string {
        return this.importer.verbose(error);
    }

    /**
     * Checks if an error is present in a new entry
     *
     * @param row the NewEntry
     * @param error An error as defined as key of {@link errorList}
     * @returns true if the error is present in the entry described in the row
     */
    public hasError(row: NewEntry<M>, error: string): boolean {
        return this.importer.hasError(row, error);
    }

    public async enterFullscreen(dialogTemplate: TemplateRef<any>): Promise<void> {
        const ref = this.dialog.open(dialogTemplate, { width: `80vw` });
        await ref.afterClosed().toPromise();
    }

    public isArray(data: any): boolean {
        return Array.isArray(data);
    }

    public isObject(data: any): boolean {
        return typeof data === `object`;
    }

    public getLabelByStepPhase(phase: ImportStepPhase): string {
        switch (phase) {
            case ImportStepPhase.FINISHED:
                return `have been created`;
            case ImportStepPhase.ERROR:
                return `could not be created`;
            default:
                return `will be created`;
        }
    }

    private createColumnSet(): PblNgridColumnSet {
        return columnFactory()
            .default({ minWidth: 150 })
            .table(...this.defaultColumns, ...this.createColumns())
            .build();
    }

    private createColumns(): PblColumnDefinition[] {
        const getHeaderProp = (prop: string) => {
            return prop.startsWith(`newEntry.`) ? prop : `newEntry.${prop}`;
        };
        const definitions = this.columns ?? this.headerDefinition;
        if (!definitions) {
            throw new Error(`You have to specify the columns to show`);
        }
        if (Array.isArray(definitions) && definitions.length > 0) {
            return definitions
                .filter((definition: ImportListViewHeaderDefinition) => definition.isTableColumn)
                .map(column => ({
                    ...column,
                    prop: getHeaderProp(column.prop),
                    type: this.getTypeByProperty(getHeaderProp(column.prop).slice(`newEntry.`.length))
                }));
        }
    }

    private createRequiredFields(): string[] {
        const definitions = this.columns ?? this.headerDefinition;
        if (Array.isArray(definitions) && definitions.length > 0) {
            return definitions
                .filter((definition: ImportListViewHeaderDefinition) => definition.isRequired)
                .map(definition => definition.label);
        } else {
            return [];
        }
    }

    /**
     * Resets the height of the displayed rows to the passed `rowHeight`-property.
     */
    private resetRowHeight(): void {
        const styleProperty = `--os-row-height`;
        if (this.rowHeight > 0) {
            this._root.style.setProperty(styleProperty, `${this.rowHeight}px`);
        } else {
            this._root.style.removeProperty(styleProperty);
        }
    }

    private getTypeByProperty(property: string): 'boolean' | 'string' {
        if (property.startsWith(`is`) || property.startsWith(`has`)) {
            return `boolean`;
        } else {
            return `string`;
        }
    }
}
