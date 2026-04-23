export interface SharepointWeb {
  Title: string;
  Url: string;
  ServerRelativeUrl: string;
  Created: string;
  LastItemModifiedDate: string;
  Description: string;
  WebTemplate: string;
}

export interface SharepointList {
  Id: string;
  Title: string;
  Description: string;
  ItemCount: number;
  BaseTemplate: number;
  BaseType: number;
  Hidden: boolean;
  IsPrivate: boolean;
  Created: string;
  LastItemModifiedDate: string;
  ParentWebUrl: string;
}

export interface SharepointListItem {
  ID: number;
  Title: string | null;
  Created: string;
  Modified: string;
  AuthorId: number;
  EditorId: number;
  [key: string]: unknown;
}
