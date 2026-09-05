// Windows App SDK 2.x exposes Windows.UI.Text.FontWeight in this unpackaged target, but the
// convenience FontWeights helper is not present in every projection. Keep the one weight Xplorer
// needs in a tiny compatibility shim instead of making Settings depend on a version-specific API.
namespace Windows.UI.Text;

internal static class FontWeights
{
    internal static FontWeight SemiBold => new() { Weight = 600 };
}
