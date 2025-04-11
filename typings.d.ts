interface Settings {
    sceneCardPerformers: boolean;
    sceneCardHighlightChanges: boolean;
}

type AnyObject =
    | "scenes"
    | "performers"
    | "studios"
    | "tags"
    | "categories"
    | "edits"
    | "drafts"
    | "users"
    | "search"

type EditOperation =
    | "create"
    | "modify"
    | "merge"
    | "destroy"

type EditTargetType =
    | "performer"
    | "scene"
    | "studio"
    | "tag"

interface LocationData {
    object: AnyObject | null;
    ident: string | null;
    action: string | null;
}

interface FetchError {
    error: boolean;
    status: number;
    body: string | null;
}

type DataObjectGetters = "type" | "changes";

type SceneChanges = Exclude<keyof SceneDataObject, DataObjectGetters | "comments" | "c_studio">;
interface SceneDataObject {
    readonly type: "SceneDataObject";
    get changes(): SceneChanges[];

    duplicates?: string[];
    duplicate_of?: string;
    title?: string;
    date?: string;
    duration?: string;
    performers?: {
        remove: PerformerEntry[];
        append: PerformerEntry[];
        update?: PerformerEntry[];
    };
    studio?: [id: string, name: string];
    code?: string;
    url?: string;
    details?: string;
    director?: string;
    // tags?: string[];
    image?: string;
    fingerprints?: SceneFingerprint[];
    comments?: string[];
    c_studio?: [name: string, parent: string | null];
}

type PerformerChanges = Exclude<keyof PerformerDataObject, DataObjectGetters | "urls_notes" | "name">;
interface PerformerDataObject {
    readonly type: "PerformerDataObject";
    get changes(): PerformerChanges[];
    readonly scenes?: PerformerScenes[string];
    readonly fragments?: PerformerFragments[string];

    duplicates?: {
        name: string;
        ids: string[];
        notes?: string[];
    };
    duplicate_of?: string;
    split?: {
        name: string;
        fragments: SplitFragment[];
        notes?: string[];
        links?: string[];
        status?: string;
    };
    urls?: string[];
    urls_notes?: string[];
    name?: string;
}

type FingerprintAlgorithm = "phash" | "oshash" | "md5";

type SceneFingerprint = {
    algorithm: FingerprintAlgorithm;
    hash: string;
    correct_scene_id: string | null;
    duration?: number;
}

interface SplitFragment {
    column: string;
    id: string | null;
    name: string;
    text?: string;
    links?: string[];
    notes?: string[];
}

interface PerformerScenes {
    [uuid: string]: {
        [sceneId: string]: keyof SceneDataObject["performers"]; // v= action
    };
}

interface PerformerFragments {
    [uuid: string]: {
        [performerId: string]: number[]; // v= fragmentIds
    };
}

interface PerformerURLFragments {
    [url: string]: {
        [performerId: string]: number[]; // v= fragmentIds
    };
}

interface DynamicDataObject {
    performerScenes: PerformerScenes;
    performerFragments: PerformerFragments;
    performerURLFragments: PerformerURLFragments;
}

interface BaseCache {
    lastUpdated?: string;
    lastChecked?: string;
    submitted: { [key in SupportedObject]: string[]; };
}

interface DataCache extends BaseCache {
    scenes: { [uuid: string]: SceneDataObject };
    performers: { [uuid: string]: PerformerDataObject };
}

type SupportedObject = Exclude<keyof DataCache, keyof BaseCache>

type DataObject = DataCache[SupportedObject][string]

type DataObjectKeys<T extends DataObject> =
    T extends PerformerDataObject ? PerformerChanges
    : T extends SceneDataObject ? SceneChanges
    : never;

type CompactDataCache = BaseCache & {
    [cacheKey: string]: DataObject;
}

type MigrationSceneDataObject = SceneDataObject & {}
type MigrationPerformerDataObject = PerformerDataObject & {}

type MigrationDataCache = DataCache & {
    scenes: { [uuid: string]: MigrationSceneDataObject };
    performers: { [uuid: string]: MigrationPerformerDataObject };
}

interface PerformerEntry {
    id: string | null;
    name: string;
    disambiguation?: string;
    appearance: string | null;
    notes?: string[];
    /** Only for remove/append */
    status?: string;
    /** Only for remove/append, with specific statuses */
    status_url?: string;
    /** Only for update */
    old_appearance?: string | null;
}

type FingerprintsColumnIndices = {
    algorithm: number;
    hash: number;
    duration: number;
    submissions: number;
    reports: number;
}

type FingerprintsRow = {
    row: HTMLTableRowElement;
    algorithm: FingerprintAlgorithm;
    hash: string;
    duration: number | null;
    submissions: number;
    reports: number;
}

type SceneEntriesItem = [id: string, data: SceneDataObject]
type PerformerEntriesItem = [id: string, data: PerformerDataObject]

type FragmentIndexMap = { [performerId: string]: number[] }


//#region Stash-Box Models
/** @see {@link https://github.com/stashapp/stash-box/blob/develop/frontend/src/graphql/definitions/Scenes.ts} */
interface ScenePerformance_URL {
    __typename: "URL";
    url: string;
    site: {
        id: string;
        name: string;
        icon: string;
    };
}

interface ScenePerformance_Image {
    __typename: "Image";
    id: string;
    url: string;
    width: number;
    height: number;
}

interface ScenePerformance_Studio {
    __typename: "Studio";
    id: string;
    name: string;
    parent?: ScenePerformance_Studio;
}

enum GenderEnum {
    FEMALE = "FEMALE",
    INTERSEX = "INTERSEX",
    MALE = "MALE",
    TRANSGENDER_FEMALE = "TRANSGENDER_FEMALE",
    TRANSGENDER_MALE = "TRANSGENDER_MALE",
}

interface ScenePerformance_Performer {
    __typename: "PerformerAppearance";
    as: string | null;
    performer: {
        __typename: "Performer";
        id: string;
        name: string;
        disambiguation: string | null;
        deleted: boolean;
        gender: GenderEnum | null;
        aliases: string[];
    };
}

interface ScenePerformance {
    __typename: "Scene";
    id: string;
    date: string | null;
    title: string | null;
    duration: number | null;
    urls: ScenePerformance_URL[];
    images: ScenePerformance_Image[];
    studio: ScenePerformance_Studio | null;
    performers: ScenePerformance_Performer[];
}
//#endregion
