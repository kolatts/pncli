namespace Feedback.Services;

/// <summary>Branded HTML email template matching the pncli site aesthetic.</summary>
internal static class EmailTemplates
{
    private const string LogoUrl   = "https://kolatts.github.io/pncli/email-logo.png";
    private const string SiteUrl   = "https://kolatts.github.io/pncli";
    private const string Ink       = "#1A1625";
    private const string Coral     = "#FF5C39";
    private const string Violet    = "#7C5CFF";
    private const string Cream     = "#FFFBF5";
    private const string Muted     = "#8D8A96";
    private const string Border    = "#EDE9E0";
    private const string CardBg    = "#FFFFFF";
    private const string OuterBg   = "#F0EBE3";

    /// <summary>
    /// Wraps <paramref name="bodyHtml"/> in the full branded email shell.
    /// <paramref name="previewText"/> appears as the inbox snippet on supported clients.
    /// </summary>
    public static string Wrap(string bodyHtml, string previewText = "")
    {
        var preview = string.IsNullOrEmpty(previewText) ? "" :
            $"<div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all\">{previewText}&nbsp;&zwnj;</div>";

        return $"""
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8"/>
              <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
              <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
              <title>pncli</title>
            </head>
            <body style="margin:0;padding:0;background-color:{OuterBg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
            {preview}
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{OuterBg}">
              <tr>
                <td align="center" style="padding:40px 16px">
                  <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">

                    <!-- Header -->
                    <tr>
                      <td style="background-color:{CardBg};border-radius:12px 12px 0 0;padding:28px 32px 20px;text-align:center;border-bottom:3px solid {Coral}">
                        <a href="{SiteUrl}" style="text-decoration:none">
                          <img src="{LogoUrl}" alt="pncli" width="140" style="display:block;margin:0 auto;max-width:140px;height:auto;border:0"/>
                        </a>
                      </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                      <td style="background-color:{CardBg};padding:32px 32px 16px">
                        {bodyHtml}
                      </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                      <td style="background-color:{CardBg};border-radius:0 0 12px 12px;padding:16px 32px 28px;border-top:1px solid {Border};text-align:center">
                        <p style="margin:0;font-size:12px;line-height:1.5;color:{Muted};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
                          You received this because you submitted feedback at
                          <a href="{SiteUrl}" style="color:{Violet};text-decoration:none">kolatts.github.io/pncli</a>
                        </p>
                      </td>
                    </tr>

                  </table>
                </td>
              </tr>
            </table>
            </body>
            </html>
            """;
    }

    public static string Heading(string text) =>
        $"""<h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:{Ink};line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">{text}</h2>""";

    public static string Para(string html) =>
        $"""<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{Ink};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">{html}</p>""";

    public static string IssueLink(int number, string url) =>
        $"""<a href="{url}" style="color:{Violet};text-decoration:none;font-family:'JetBrains Mono',Menlo,Monaco,'Courier New',monospace;font-size:14px">#{number}</a>""";

    public static string Button(string url, string label) => $"""
        <table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">
          <tr>
            <td style="background-color:{Coral};border-radius:8px;mso-padding-alt:0">
              <a href="{url}" style="display:inline-block;padding:12px 24px;color:{Cream};font-size:14px;font-weight:600;text-decoration:none;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">{label}</a>
            </td>
          </tr>
        </table>
        """;
}
