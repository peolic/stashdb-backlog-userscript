type PluralObject =
    | 'scenes'
    | 'performers'
    | 'studios'
    | 'tags'
    | 'categories'
    | 'edits'
    | 'users'
    | 'search'

interface LocationData {
    object: PluralObject | null;
    ident: string | null;
    action: string | null;
}

interface FetchError {
    error: boolean;
    status: number;
    body: string | null;
}

interface BaseCache {
    contentHash?: string;
    lastUpdated?: string;
}

interface DataIndex extends Omit<BaseCache, 'contentHash'> {
    scenes: { [uuid: string]: string[]; };
    performers: { [uuid: string]: string[]; };
}

type SupportedPluralObject = keyof Omit<DataIndex, keyof BaseCache>

interface SceneDataObject extends BaseCache {
    title?: string;
    date?: string;
    duration?: string;
    performers?: {
        remove: PerformerEntry[];
        append: PerformerEntry[];
        update?: PerformerEntry[];
    };
    studio?: [string, string];
    url?: string;
    details?: string;
    director?: string;
    // tags?: string[];
    image?: string;
    fingerprints?: Array<{
        algorithm: string;
        hash: string;
        correct_scene_id: string | null;
    }>;
    comments?: string[];
}

interface PerformerDataObject extends BaseCache {
    duplicates?: string[];
    duplicate_of: string;
}

type DataObjectMap = {
    scene: SceneDataObject;
    performer: PerformerDataObject;
}

type SupportedObject = keyof DataObjectMap

type DataObject = DataObjectMap[SupportedObject]

interface DataCache {
    [cacheKey: string]: DataObject;
}

type MutationDataIndex = DataIndex | {
    scenes: { [uuid: string]: string };
    performers: { [uuid: string]: string };
}

interface PerformerEntry {
    id: string | null;
    name: string;
    disambiguation?: string;
    appearance: string | null;
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
}
