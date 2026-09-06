using System.Globalization;
using System.Xml;
using System.Xml.Linq;
using Windows.UI;

namespace Xplorer.Native.Services;

/// <summary>
/// Loads Xplorer's deliberately small XML theme schema. Theme files are data, never XAML:
/// unknown nodes are rejected, DTD/external entities are disabled, and every numeric value is
/// clamped before it can affect layout.
/// </summary>
public static class ThemeService
{
    private const int MaximumThemeBytes = 64 * 1024;
    private const string DefaultThemeFileName = "default.xml";

    public static string ThemeDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "Themes");

    public sealed record InspectionResult(
        XplorerThemeDefinition Definition,
        IReadOnlyList<string> MissingProperties);

    public static string EnsureDefaultThemeFile()
    {
        Directory.CreateDirectory(ThemeDirectory);
        var path = Path.Combine(ThemeDirectory, DefaultThemeFileName);
        if (!File.Exists(path))
        {
            File.WriteAllText(path, DefaultThemeXml);
            return path;
        }

        // Migrate only Xplorer's untouched legacy template. A user-edited default.xml is their
        // theme and must never be silently rewritten just because native chrome dimensions changed.
        try
        {
            var existing = NormalizeTemplate(File.ReadAllText(path));
            if (string.Equals(existing, NormalizeTemplate(LegacyDefaultThemeXml), StringComparison.Ordinal))
                File.WriteAllText(path, DefaultThemeXml);
        }
        catch
        {
            // Loading/validation below will report any real file-system problem. Migration itself
            // is best-effort and must not turn an otherwise usable Xplorer startup into a failure.
        }

        return path;
    }

    private static string NormalizeTemplate(string value) =>
        value.Replace("\r\n", "\n", StringComparison.Ordinal).Trim();

    public static string ResolveThemePath(string fileName)
    {
        var normalized = string.IsNullOrWhiteSpace(fileName)
            ? DefaultThemeFileName
            : fileName.Trim();

        if (!string.Equals(Path.GetFileName(normalized), normalized, StringComparison.Ordinal) ||
            !string.Equals(Path.GetExtension(normalized), ".xml", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Theme file must be a single .xml filename inside Xplorer's Themes folder.");
        }

        return Path.Combine(ThemeDirectory, normalized);
    }

    public static XplorerThemeDefinition Load(string fileName) => Analyze(fileName).Definition;

    public static InspectionResult Analyze(string fileName)
    {
        EnsureDefaultThemeFile();
        var path = ResolveThemePath(fileName);
        var document = ReadDocument(path);
        var root = ValidateRoot(document);
        var definition = ParseDefinition(root);
        var missing = FindMissingProperties(root);
        return new InspectionResult(definition, missing);
    }

    private static XDocument ReadDocument(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists)
            throw new FileNotFoundException("The selected Xplorer XML theme does not exist.", path);
        if (info.Length > MaximumThemeBytes)
            throw new InvalidDataException("Xplorer theme files are limited to 64 KiB.");

        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaximumThemeBytes,
            IgnoreComments = true,
            IgnoreWhitespace = true,
        };

        using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var reader = XmlReader.Create(stream, settings);
        return XDocument.Load(reader, LoadOptions.None);
    }

    private static XElement ValidateRoot(XDocument document)
    {
        var root = document.Root ?? throw new InvalidDataException("Theme XML has no root element.");
        if (root.Name != XName.Get("XplorerTheme"))
            throw new InvalidDataException("Theme root must be an un-namespaced <XplorerTheme> element.");
        if ((string?)root.Attribute("version") != "1")
            throw new InvalidDataException("Only XplorerTheme version=\"1\" is supported.");

        RejectUnknownAttributes(root, "version");
        RejectUnknownChildren(root, "Colors", "Layout", "Files");
        return root;
    }

    private static XplorerThemeDefinition ParseDefinition(XElement root)
    {
        var result = XplorerThemeDefinition.Default;
        if (root.Element("Colors") is { } colors)
        {
            RejectUnknownAttributes(colors);
            RejectUnknownChildren(colors, "Background", "Surface", "Rail", "Accent");
            result = result with
            {
                Background = ReadColor(colors, "Background", result.Background),
                Surface = ReadColor(colors, "Surface", result.Surface),
                Rail = ReadColor(colors, "Rail", result.Rail),
                Accent = ReadColor(colors, "Accent", result.Accent),
            };
        }

        if (root.Element("Layout") is { } layout)
        {
            RejectUnknownAttributes(layout);
            RejectUnknownChildren(layout, "SidebarWidth", "InspectorWidth", "TabHeight");
            result = result with
            {
                SidebarWidth = ReadDouble(layout, "SidebarWidth", result.SidebarWidth, 140, 480),
                // The rail owns 34 px buttons plus padding/border/scrollbar breathing room.
                InspectorWidth = ReadDouble(layout, "InspectorWidth", result.InspectorWidth, 48, 112),
                TabHeight = ReadDouble(layout, "TabHeight", result.TabHeight, 32, 64),
            };
        }

        if (root.Element("Files") is { } files)
        {
            RejectUnknownAttributes(files);
            RejectUnknownChildren(files, "MediumTileWidth", "MediumTileHeight", "LargeTileWidth", "LargeTileHeight");
            result = result with
            {
                MediumTileWidth = ReadDouble(files, "MediumTileWidth", result.MediumTileWidth, 84, 220),
                MediumTileHeight = ReadDouble(files, "MediumTileHeight", result.MediumTileHeight, 96, 220),
                LargeTileWidth = ReadDouble(files, "LargeTileWidth", result.LargeTileWidth, 120, 300),
                LargeTileHeight = ReadDouble(files, "LargeTileHeight", result.LargeTileHeight, 132, 300),
            };
        }

        return result;
    }

    private static IReadOnlyList<string> FindMissingProperties(XElement root)
    {
        var missing = new List<string>();
        AddMissing(root.Element("Colors"), "Colors", missing, "Background", "Surface", "Rail", "Accent");
        AddMissing(root.Element("Layout"), "Layout", missing, "SidebarWidth", "InspectorWidth", "TabHeight");
        AddMissing(root.Element("Files"), "Files", missing, "MediumTileWidth", "MediumTileHeight", "LargeTileWidth", "LargeTileHeight");
        return missing;
    }

    private static void AddMissing(XElement? section, string sectionName, List<string> missing, params string[] names)
    {
        foreach (var name in names)
        {
            if (section?.Element(name) is null)
                missing.Add($"{sectionName}.{name}");
        }
    }

    private static Color ReadColor(XElement parent, string name, Color fallback)
    {
        var element = parent.Element(name);
        if (element is null) return fallback;
        ValidateLeaf(element);
        var text = element.Value.Trim();
        if (string.IsNullOrEmpty(text)) return fallback;
        if (text[0] == '#') text = text[1..];

        uint value;
        if (text.Length == 6 && uint.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value))
            return Color.FromArgb(0xff, (byte)(value >> 16), (byte)(value >> 8), (byte)value);
        if (text.Length == 8 && uint.TryParse(text, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value))
            return Color.FromArgb((byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value);

        throw new InvalidDataException($"<{name}> must be #RRGGBB or #AARRGGBB.");
    }

    private static double ReadDouble(XElement parent, string name, double fallback, double min, double max)
    {
        var element = parent.Element(name);
        if (element is null) return fallback;
        ValidateLeaf(element);
        var text = element.Value.Trim();
        if (string.IsNullOrEmpty(text)) return fallback;
        if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ||
            double.IsNaN(value) || double.IsInfinity(value))
        {
            throw new InvalidDataException($"<{name}> must be a finite number.");
        }
        return Math.Clamp(value, min, max);
    }

    private static void ValidateLeaf(XElement element)
    {
        RejectUnknownAttributes(element);
        if (element.Elements().Any())
            throw new InvalidDataException($"Theme value <{element.Name.LocalName}> cannot contain child elements.");
    }

    private static void RejectUnknownAttributes(XElement element, params string[] allowed)
    {
        var allowedSet = allowed.ToHashSet(StringComparer.Ordinal);
        var unknown = element.Attributes().FirstOrDefault(attribute =>
            attribute.IsNamespaceDeclaration ||
            attribute.Name.Namespace != XNamespace.None ||
            !allowedSet.Contains(attribute.Name.LocalName));
        if (unknown is not null)
            throw new InvalidDataException($"Unknown or namespaced theme attribute '{unknown.Name}'.");
    }

    private static void RejectUnknownChildren(XElement element, params string[] allowed)
    {
        var allowedSet = allowed.ToHashSet(StringComparer.Ordinal);
        var children = element.Elements().ToList();
        var unknown = children.FirstOrDefault(child =>
            child.Name.Namespace != XNamespace.None ||
            !allowedSet.Contains(child.Name.LocalName));
        if (unknown is not null)
            throw new InvalidDataException($"Unknown or namespaced theme element <{unknown.Name}>.");

        var duplicate = children
            .GroupBy(child => child.Name.LocalName, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
            throw new InvalidDataException($"Theme element <{duplicate.Key}> can appear only once in its parent.");
    }

    private const string LegacyDefaultThemeXml = """
        <?xml version="1.0" encoding="utf-8"?>
        <XplorerTheme version="1">
          <Colors>
            <Background>#111116</Background>
            <Surface>#191920</Surface>
            <Rail>#15151B</Rail>
            <Accent>#6D6AFB</Accent>
          </Colors>
          <Layout>
            <SidebarWidth>220</SidebarWidth>
            <InspectorWidth>48</InspectorWidth>
            <TabHeight>38</TabHeight>
          </Layout>
          <Files>
            <MediumTileWidth>116</MediumTileWidth>
            <MediumTileHeight>104</MediumTileHeight>
            <LargeTileWidth>170</LargeTileWidth>
            <LargeTileHeight>148</LargeTileHeight>
          </Files>
        </XplorerTheme>
        """;

    private const string DefaultThemeXml = """
        <?xml version="1.0" encoding="utf-8"?>
        <XplorerTheme version="1">
          <Colors>
            <Background>#111116</Background>
            <Surface>#191920</Surface>
            <Rail>#15151B</Rail>
            <Accent>#6D6AFB</Accent>
          </Colors>
          <Layout>
            <SidebarWidth>256</SidebarWidth>
            <InspectorWidth>48</InspectorWidth>
            <TabHeight>32</TabHeight>
          </Layout>
          <Files>
            <MediumTileWidth>116</MediumTileWidth>
            <MediumTileHeight>104</MediumTileHeight>
            <LargeTileWidth>170</LargeTileWidth>
            <LargeTileHeight>148</LargeTileHeight>
          </Files>
        </XplorerTheme>
        """;
}

public sealed record XplorerThemeDefinition(
    Color Background,
    Color Surface,
    Color Rail,
    Color Accent,
    double SidebarWidth,
    double InspectorWidth,
    double TabHeight,
    double MediumTileWidth,
    double MediumTileHeight,
    double LargeTileWidth,
    double LargeTileHeight)
{
    public static XplorerThemeDefinition Default { get; } = new(
        Color.FromArgb(0xff, 0x11, 0x11, 0x16),
        Color.FromArgb(0xff, 0x19, 0x19, 0x20),
        Color.FromArgb(0xff, 0x15, 0x15, 0x1b),
        Color.FromArgb(0xff, 0x6d, 0x6a, 0xfb),
        256,
        48,
        32,
        116,
        104,
        170,
        148);
}
