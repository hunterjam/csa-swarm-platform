using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

var authEnabled = !string.Equals(
    builder.Configuration["AUTH_ENABLED"],
    "false",
    StringComparison.OrdinalIgnoreCase
);
var tenantId = builder.Configuration["ENTRA_TENANT_ID"] ?? "";
var clientId = builder.Configuration["ENTRA_CLIENT_ID"] ?? "";
var backendUrl = builder.Configuration["GATEWAY_BACKEND_URL"] ?? "";
var sharedSecret = builder.Configuration["GATEWAY_SHARED_SECRET"] ?? "";

if (string.IsNullOrWhiteSpace(backendUrl))
{
    throw new InvalidOperationException("GATEWAY_BACKEND_URL must be set.");
}
if (string.IsNullOrWhiteSpace(sharedSecret))
{
    throw new InvalidOperationException("GATEWAY_SHARED_SECRET must be set.");
}
if (authEnabled && (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId)))
{
    throw new InvalidOperationException(
        "ENTRA_TENANT_ID and ENTRA_CLIENT_ID are required when AUTH_ENABLED=true."
    );
}

builder.Services.AddHttpClient("backend");

if (authEnabled)
{
    builder.Services
        .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApi(
            jwtOptions =>
            {
                jwtOptions.Authority = $"https://login.microsoftonline.com/{tenantId}/v2.0";
                jwtOptions.TokenValidationParameters.ValidAudience = clientId;
            },
            identityOptions =>
            {
                identityOptions.Instance = "https://login.microsoftonline.com/";
                identityOptions.TenantId = tenantId;
                identityOptions.ClientId = clientId;
            }
        );
    builder.Services.AddAuthorization();
}

var app = builder.Build();

if (authEnabled)
{
    app.UseAuthentication();
    app.UseAuthorization();
}

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapMethods("/api/{**path}", new[] { "GET", "POST", "PUT", "PATCH", "DELETE" }, ProxyApiAsync);

app.Run();

async Task ProxyApiAsync(HttpContext context, IHttpClientFactory httpClientFactory)
{
    if (authEnabled && !(context.User?.Identity?.IsAuthenticated ?? false))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { detail = "Missing or invalid Authorization header" });
        return;
    }

    var path = context.Request.RouteValues["path"]?.ToString() ?? "";
    var target = $"{backendUrl.TrimEnd('/')}/api/{path}{context.Request.QueryString}";

    using var requestMessage = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);

    foreach (var header in context.Request.Headers)
    {
        if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
            header.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase))
        {
            continue;
        }

        if (!requestMessage.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
        {
            requestMessage.Content ??= new StreamContent(context.Request.Body);
            requestMessage.Content.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
    }

    if (requestMessage.Content is null && context.Request.ContentLength is > 0)
    {
        requestMessage.Content = new StreamContent(context.Request.Body);
    }

    var userPayload = BuildUserPayload(context.User, authEnabled);
    requestMessage.Headers.TryAddWithoutValidation(
        "X-Authenticated-User",
        Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(userPayload)))
    );
    requestMessage.Headers.TryAddWithoutValidation("X-Gateway-Shared-Secret", sharedSecret);

    using var responseMessage = await httpClientFactory
        .CreateClient("backend")
        .SendAsync(requestMessage, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);

    context.Response.StatusCode = (int)responseMessage.StatusCode;

    foreach (var header in responseMessage.Headers)
    {
        context.Response.Headers[header.Key] = header.Value.ToArray();
    }
    foreach (var header in responseMessage.Content.Headers)
    {
        context.Response.Headers[header.Key] = header.Value.ToArray();
    }
    context.Response.Headers.Remove("transfer-encoding");

    await responseMessage.Content.CopyToAsync(context.Response.Body);
}

static Dictionary<string, string> BuildUserPayload(ClaimsPrincipal user, bool authEnabled)
{
    if (!authEnabled)
    {
        return new Dictionary<string, string>
        {
            ["sub"] = "dev-user",
            ["name"] = "Dev User",
            ["email"] = "dev@localhost",
        };
    }

    var sub = user.FindFirstValue("sub")
              ?? user.FindFirstValue("oid")
              ?? user.FindFirstValue(ClaimTypes.NameIdentifier)
              ?? "";
    var name = user.FindFirstValue("name") ?? user.Identity?.Name ?? "";
    var email = user.FindFirstValue("preferred_username")
                ?? user.FindFirstValue(ClaimTypes.Upn)
                ?? user.FindFirstValue(ClaimTypes.Email)
                ?? "";

    if (string.IsNullOrWhiteSpace(sub))
    {
        throw new InvalidOperationException("Authenticated token is missing subject/oid claim.");
    }

    return new Dictionary<string, string>
    {
        ["sub"] = sub,
        ["name"] = name,
        ["email"] = email,
    };
}
