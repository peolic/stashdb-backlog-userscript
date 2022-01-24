type AnyObject =
    | "scenes"
    | "performers"
    | "studios"
    | "tags"
    | "categories"
    | "edits"
    | "users"
    | "search"

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

type SceneFingerprint = {
    algorithm: string;
    hash: string;
    correct_scene_id: string | null;
}

interface SceneDataObject {
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
    url?: string;
    details?: string;
    director?: string;
    // tags?: string[];
    image?: string;
    fingerprints?: SceneFingerprint[];
    comments?: string[];
}

interface SplitShard {
    id: string | null;
    name: string;
    text?: string;
    links?: string[];
    notes?: string[];
}

interface PerformerDataObject {
    duplicates?: {
        ids: string[];
        notes?: string[];
    };
    duplicate_of?: string;
    split?: {
        name: string;
        shards: SplitShard[];
        notes?: string[];
    };
}

interface PerformerScenes {
    [uuid: string]: Array<{
        sceneId: string;
        action: keyof SceneDataObject["performers"];
    }>;
}

interface BaseCache {
    lastUpdated?: string;
    lastChecked?: string;
}

interface DataCache extends BaseCache {
    scenes: { [uuid: string]: SceneDataObject };
    performers: { [uuid: string]: PerformerDataObject };
}

type SupportedObject = Exclude<keyof DataCache, keyof BaseCache>

type DataObject = DataCache[SupportedObject][string]

type ObjectKeys = {
    performers: keyof PerformerDataObject | "scenes"
    scenes: keyof SceneDataObject
}

type DataObjectKeys<T extends DataObject> =
    T extends PerformerDataObject ? ObjectKeys["performers"] :
    T extends SceneDataObject ? ObjectKeys["scenes"] :
    never;

type MutationDataCache = BaseCache & {
    [cacheKey: string]: DataObject;
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
}

//#region https://github.com/stashapp/stash-box/blob/develop/frontend/src/graphql/definitions/Scenes.ts
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
