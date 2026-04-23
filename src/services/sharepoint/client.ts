import type { HttpClient } from '../../lib/http.js';
import type { SharepointWeb, SharepointList, SharepointListItem } from '../../types/sharepoint.js';

export class SharepointClient {
  constructor(
    private http: HttpClient,
    private siteUrl: string
  ) {}

  async getSite(): Promise<SharepointWeb> {
    return this.http.sharepoint<SharepointWeb>('/_api/web', {}, this.siteUrl);
  }

  async listLists(): Promise<SharepointList[]> {
    const data = await this.http.sharepoint<{ value: SharepointList[] }>(
      '/_api/web/lists',
      { params: { $select: 'Id,Title,Description,ItemCount,BaseTemplate,BaseType,Hidden,IsPrivate,Created,LastItemModifiedDate,ParentWebUrl' } },
      this.siteUrl
    );
    return data.value;
  }

  async getListItems(listTitle: string, top: number): Promise<SharepointListItem[]> {
    const escapedTitle = listTitle.replace(/'/g, "''");
    const data = await this.http.sharepoint<{ value: SharepointListItem[] }>(
      `/_api/web/lists/GetByTitle('${escapedTitle}')/items`,
      { params: { $top: top } },
      this.siteUrl
    );
    return data.value;
  }
}
