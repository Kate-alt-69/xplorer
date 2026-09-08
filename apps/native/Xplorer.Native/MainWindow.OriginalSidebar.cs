using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _originalSidebarInitialized;
    private bool _syncingOriginalSidebarSearch;
    private string? _originalSidebarObservedPath;
    private string? _activeOriginalCollection;
    private ScrollViewer? _originalSidebarExplorerPane;
    private Grid? _originalSidebarSearchPane;
    private TextBox? _originalSidebarSearchBox;
    private TextBlock? _originalSidebarSearchSummary;
    private StackPanel? _originalRecentContent;
    private StackPanel? _originalBookmarksContent;
    private StackPanel? _originalCollectionsContent;
    private TreeView? _originalFileTree;
    private Button? _originalExplorerTabButton;
    private Button? _originalSearchTabButton;
    private readonly Dictionary<string, Button> _originalQuickAccessButtons =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _originalTreePopulated =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Rebuilds the left panel around the same hierarchy as the original client: Explorer/Search
    /// tabs, Quick Access, Recent, Bookmarks, Collections, Drives and File Tree. The old compiled
    /// DriveList is deliberately reused so WM_DEVICECHANGE and real Shell RMB behavior remain owned
    /// by the existing native drive implementation instead of being duplicated here.
    /// </summary>
    private void InitializeOriginalSidebarParity()
    {
        if (_originalSidebarInitialized) return;
        _originalSidebarInitialized = true;

        if (SidebarBorder.Child is not Grid oldSidebar) return;

        oldSidebar.Children.Remove(DriveList);

        var root = new Grid
        {
            MinWidth = 0,
            Background = OriginalSidebarBrush("XplorerSurfaceBrush", Color.FromArgb(0xff, 0x11, 0x11, 0x22)),
        };
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var tabBar = BuildOriginalSidebarTabBar();
        Grid.SetRow(tabBar, 0);
        root.Children.Add(tabBar);

        var contentHost = new Grid { MinHeight = 0 };
        Grid.SetRow(contentHost, 1);
        root.Children.Add(contentHost);

        _originalSidebarExplorerPane = BuildOriginalSidebarExplorerPane();
        _originalSidebarSearchPane = BuildOriginalSidebarSearchPane();
        contentHost.Children.Add(_originalSidebarExplorerPane);
        contentHost.Children.Add(_originalSidebarSearchPane);

        SidebarBorder.Child = root;

        SearchBox.Visibility = Visibility.Collapsed;
        if (AddressChrome.ColumnDefinitions.Count >= 3)
            AddressChrome.ColumnDefinitions[2].Width = new GridLength(0);

        SearchBox.TextChanged += OriginalSearchBox_TextChanged;
        AddressBox.TextChanged += OriginalSidebarAddress_TextChanged;
        Drives.CollectionChanged += (_, _) =>
        {
            RefreshOriginalDriveListHeight();
            RefreshOriginalFileTreeRoots();
        };

        RefreshOriginalDriveListHeight();
        RefreshOriginalSidebarRecent();
        RefreshOriginalSidebarBookmarks();
        RefreshOriginalSidebarCollections();
        RefreshOriginalFileTreeRoots();
        RefreshOriginalSidebarState();
        RefreshOriginalSidebarSearchPresentation();
        ShowOriginalSidebarExplorer();
        InitializeFileInteractionParity();
    }

    private Border BuildOriginalSidebarTabBar()
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 2,
            Padding = new Thickness(8, 4, 8, 4),
        };

        _originalExplorerTabButton = CreateOriginalSidebarTabButton("\uE8B7", "File Explorer");
        _originalSearchTabButton = CreateOriginalSidebarTabButton("\uE721", "Search (Ctrl+F)");
        _originalExplorerTabButton.Click += (_, _) => ShowOriginalSidebarExplorer();
        _originalSearchTabButton.Click += (_, _) => ShowOriginalSidebarSearch(focus: true);
        panel.Children.Add(_originalExplorerTabButton);
        panel.Children.Add(_originalSearchTabButton);

        return new Border
        {
            BorderBrush = OriginalSidebarBrush("XplorerBorderBrush", Color.FromArgb(0x38, 0xff, 0xff, 0xff)),
            BorderThickness = new Thickness(0, 0, 0, 1),
            Child = panel,
        };
    }

    private Button CreateOriginalSidebarTabButton(string glyph, string tooltip)
    {
        var button = new Button
        {
            Width = 28,
            Height = 28,
            MinWidth = 28,
            Padding = new Thickness(0),
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(4),
            Background = new SolidColorBrush(Colors.Transparent),
            Foreground = OriginalSidebarBrush("XplorerTextMutedBrush", Color.FromArgb(0xff, 0x94, 0xa3, 0xb8)),
            Content = new FontIcon { Glyph = glyph, FontSize = 15 },
        };
        ToolTipService.SetToolTip(button, tooltip);
        return button;
    }

    private ScrollViewer BuildOriginalSidebarExplorerPane()
    {
        var stack = new StackPanel { Spacing = 0 };

        var quick = CreateOriginalSidebarSection("QUICK ACCESS", "\uE80F", out var quickContent);
        foreach (var location in new[]
                 {
                     (Tag: "Home", Label: "Home", Glyph: "\uE80F"),
                     (Tag: "Documents", Label: "Documents", Glyph: "\uE8A5"),
                     (Tag: "Downloads", Label: "Downloads", Glyph: "\uE896"),
                     (Tag: "Desktop", Label: "Desktop", Glyph: "\uE7F4"),
                     (Tag: "Pictures", Label: "Pictures", Glyph: "\uEB9F"),
                 })
        {
            var button = CreateOriginalSidebarLocationButton(location.Tag, location.Label, location.Glyph);
            _originalQuickAccessButtons[location.Tag] = button;
            quickContent.Children.Add(button);
        }
        stack.Children.Add(quick);

        var recent = CreateOriginalSidebarSection("RECENT", "\uE823", out var recentContent);
        _originalRecentContent = recentContent;
        stack.Children.Add(recent);

        var bookmarks = CreateOriginalSidebarSection(
            "BOOKMARKS",
            "\uE734",
            out var bookmarkContent,
            addAction: AddCurrentFolderBookmark);
        _originalBookmarksContent = bookmarkContent;
        stack.Children.Add(bookmarks);

        var collections = CreateOriginalSidebarSection("COLLECTIONS", "\uE8B7", out var collectionContent);
        _originalCollectionsContent = collectionContent;
        stack.Children.Add(collections);

        var drives = CreateOriginalSidebarSection("DRIVES", "\uEDA2", out var driveContent);
        DriveList.Margin = new Thickness(3, 0, 3, 4);
        driveContent.Children.Add(DriveList);
        stack.Children.Add(drives);

        var fileTree = CreateOriginalSidebarSection("FILE TREE", "\uE8B7", out var treeContent);
        _originalFileTree = new TreeView
        {
            SelectionMode = TreeViewSelectionMode.Single,
            MaxHeight = 280,
            Margin = new Thickness(3, 0, 3, 5),
        };
        _originalFileTree.Expanding += OriginalFileTree_Expanding;
        _originalFileTree.ItemInvoked += OriginalFileTree_ItemInvoked;
        treeContent.Children.Add(_originalFileTree);
        stack.Children.Add(fileTree);

        return new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = stack,
        };
    }

    private Grid BuildOriginalSidebarSearchPane()
    {
        var pane = new Grid
        {
            Visibility = Visibility.Collapsed,
            Padding = new Thickness(8),
        };
        pane.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        pane.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        pane.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        _originalSidebarSearchBox = new TextBox
        {
            Height = 30,
            Padding = new Thickness(8, 1, 8, 1),
            Background = OriginalSidebarBrush("XplorerSurfaceLightBrush", Color.FromArgb(0xff, 0x1a, 0x1a, 0x32)),
            BorderBrush = OriginalSidebarBrush("XplorerBorderLightBrush", Color.FromArgb(0x45, 0xff, 0xff, 0xff)),
            Foreground = OriginalSidebarBrush("XplorerTextBrush", Colors.White),
            VerticalContentAlignment = VerticalAlignment.Center,
            FontSize = 12,
        };
        _originalSidebarSearchBox.TextChanged += OriginalSidebarSearchBox_TextChanged;
        pane.Children.Add(_originalSidebarSearchBox);

        _originalSidebarSearchSummary = new TextBlock
        {
            Margin = new Thickness(2, 8, 2, 4),
            Foreground = OriginalSidebarBrush("XplorerTextMutedBrush", Color.FromArgb(0xff, 0x94, 0xa3, 0xb8)),
            FontSize = 10,
            TextWrapping = TextWrapping.Wrap,
        };
        Grid.SetRow(_originalSidebarSearchSummary, 1);
        pane.Children.Add(_originalSidebarSearchSummary);

        var hint = new TextBlock
        {
            Text = "Search results stay in the main file view so selection, Inspector, RMB and drag/drop use the same native item controls.",
            Foreground = OriginalSidebarBrush("XplorerTextMutedBrush", Color.FromArgb(0xff, 0x94, 0xa3, 0xb8)),
            Opacity = 0.72,
            FontSize = 10,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(2, 8, 2, 0),
        };
        Grid.SetRow(hint, 2);
        pane.Children.Add(hint);
        return pane;
    }

    private Border CreateOriginalSidebarSection(
        string title,
        string glyph,
        out StackPanel content,
        Action? addAction = null)
    {
        var wrapper = new Grid();
        wrapper.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        wrapper.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        content = new StackPanel
        {
            Spacing = 1,
            Padding = new Thickness(7, 0, 7, 6),
        };
        Grid.SetRow(content, 1);

        var chevron = new FontIcon { Glyph = "\uE70D", FontSize = 9 };
        var headerPanel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        headerPanel.Children.Add(chevron);
        headerPanel.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12 });
        headerPanel.Children.Add(new TextBlock
        {
            Text = title,
            FontSize = 10,
            CharacterSpacing = 80,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var toggle = new Button
        {
            Height = 28,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(9, 0, 6, 0),
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(0),
            Background = new SolidColorBrush(Colors.Transparent),
            Foreground = OriginalSidebarBrush("XplorerTextMutedBrush", Color.FromArgb(0xff, 0x94, 0xa3, 0xb8)),
            Content = headerPanel,
        };
        toggle.Click += (_, _) =>
        {
            var expanded = content.Visibility == Visibility.Visible;
            content.Visibility = expanded ? Visibility.Collapsed : Visibility.Visible;
            chevron.Glyph = expanded ? "\uE76C" : "\uE70D";
        };

        if (addAction is null)
        {
            wrapper.Children.Add(toggle);
        }
        else
        {
            var header = new Grid();
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.Children.Add(toggle);

            var add = new Button
            {
                Width = 26,
                Height = 26,
                MinWidth = 26,
                Margin = new Thickness(0, 1, 5, 1),
                Padding = new Thickness(0),
                BorderThickness = new Thickness(0),
                Background = new SolidColorBrush(Colors.Transparent),
                Foreground = OriginalSidebarBrush("XplorerTextMutedBrush", Color.FromArgb(0xff, 0x94, 0xa3, 0xb8)),
                Content = new FontIcon { Glyph = "\uE710", FontSize = 12 },
            };
            Grid.SetColumn(add, 1);
            ToolTipService.SetToolTip(add, "Add current folder");
            add.Click += (_, _) => addAction();
            header.Children.Add(add);
            wrapper.Children.Add(header);
        }

        wrapper.Children.Add(content);
        return new Border
        {
            BorderBrush = OriginalSidebarBrush("XplorerBorderBrush", Color.FromArgb(0x38, 0xff, 0xff, 0xff)),
            BorderThickness = new Thickness(0, 0, 0, 1),
            Child = wrapper,
        };
    }

    private Button CreateOriginalSidebarLocationButton(string tag, string label, string glyph)
    {
        var button = new Button
        {
            Tag = tag,
            Height = 30,
            Margin = new Thickness(0),
            Padding = new Thickness(8, 3, 8, 3),
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(4),
            Background = new SolidColorBrush(Colors.Transparent),
            Foreground = OriginalSidebarBrush("XplorerTextSecondaryBrush", Color.FromArgb(0xff, 0xcb, 0xd5, 0xe1)),
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        var row = new Grid { ColumnSpacing = 9 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 14,
            Foreground = OriginalSidebarBrush("XplorerBlueBrush", Color.FromArgb(0xff, 0x3b, 0x82, 0xf6)),
        });
        var text = new TextBlock
        {
            Text = label,
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(text, 1);
        row.Children.Add(text);
        button.Content = row;
        button.Click += SidebarLocation_Click;
        return button;
    }

    private void OriginalSidebarAddress_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_originalSidebarInitialized) return;
        var path = CurrentPath;
        if (string.Equals(path, _originalSidebarObservedPath, StringComparison.OrdinalIgnoreCase))
        {
            RefreshOriginalSidebarState();
            return;
        }

        _originalSidebarObservedPath = path;
        if (Directory.Exists(path) && RecentLocationService.Record(path, isDirectory: true))
            RefreshOriginalSidebarRecent();

        _activeOriginalCollection = null;
        RefreshOriginalSidebarCollections();
        RefreshOriginalSidebarState();
    }

    private void RefreshOriginalSidebarState()
    {
        if (!_originalSidebarInitialized) return;
        foreach (var pair in _originalQuickAccessButtons)
        {
            var target = ResolveOriginalSidebarLocation(pair.Key);
            var active = target is not null &&
                         string.Equals(target, CurrentPath, StringComparison.OrdinalIgnoreCase);
            pair.Value.Background = active
                ? OriginalSidebarAccentBackground(0x2a)
                : new SolidColorBrush(Colors.Transparent);
            pair.Value.Foreground = active
                ? OriginalSidebarBrush("XplorerBlueBrush", Color.FromArgb(0xff, 0x3b, 0x82, 0xf6))
                : OriginalSidebarBrush("XplorerTextSecondaryBrush", Color.FromArgb(0xff, 0xcb, 0xd5, 0xe1));
        }
        RefreshOriginalSidebarSearchSummary();
    }

    private string? ResolveOriginalSidebarLocation(string location) => location switch
    {
        "Home" => _homePath,
        "Desktop" => Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
        "Downloads" => Path.Combine(_homePath, "Downloads"),
        "Documents" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        "Pictures" => Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
        _ => null,
    };

    private void RefreshOriginalSidebarRecent()
    {
        if (_originalRecentContent is null) return;
        _originalRecentContent.Children.Clear();
        var recent = RecentLocationService.Get(10);
        if (recent.Count == 0)
        {
            _originalRecentContent.Children.Add(CreateOriginalSidebarEmptyText("No recent files"));
            return;
        }

        foreach (var entry in recent)
        {
            var label = Path.GetFileName(entry.Path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrWhiteSpace(label)) label = entry.Path;
            var button = CreateOriginalSidebarPathButton(
                label,
                entry.Path,
                entry.IsDirectory ? "\uE8B7" : "\uE7C3");
            button.Click += async (_, _) =>
            {
                var target = entry.IsDirectory ? entry.Path : Path.GetDirectoryName(entry.Path);
                if (!string.IsNullOrWhiteSpace(target) && Directory.Exists(target))
                    await NavigateAsync(target);
            };
            _originalRecentContent.Children.Add(button);
        }
    }

    private void AddCurrentFolderBookmark()
    {
        if (SidebarBookmarkService.Add(CurrentPath))
            RefreshOriginalSidebarBookmarks();
    }

    private void RefreshOriginalSidebarBookmarks()
    {
        if (_originalBookmarksContent is null) return;
        _originalBookmarksContent.Children.Clear();
        var bookmarks = SidebarBookmarkService.Get();
        if (bookmarks.Count == 0)
        {
            _originalBookmarksContent.Children.Add(CreateOriginalSidebarEmptyText("No bookmarks"));
            return;
        }

        foreach (var path in bookmarks)
        {
            var label = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrWhiteSpace(label)) label = path;
            var button = CreateOriginalSidebarPathButton(label, path, "\uE734");
            button.Click += async (_, _) => await NavigateAsync(path);

            var menu = new MenuFlyout();
            var remove = new MenuFlyoutItem { Text = "Remove bookmark" };
            remove.Click += (_, _) =>
            {
                if (SidebarBookmarkService.Remove(path)) RefreshOriginalSidebarBookmarks();
            };
            menu.Items.Add(remove);
            button.ContextFlyout = menu;
            _originalBookmarksContent.Children.Add(button);
        }
    }

    private Button CreateOriginalSidebarPathButton(string label, string path, string glyph)
    {
        var button = new Button
        {
            Height = 29,
            Padding = new Thickness(8, 2, 8, 2),
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(4),
            Background = new SolidColorBrush(Colors.Transparent),
            Foreground = OriginalSidebarBrush("XplorerTextSecondaryBrush", Color.FromArgb(0xff, 0xcb, 0xd5, 0xe1)),
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        ToolTipService.SetToolTip(button, path);
        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(17) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 13 });
        var text = new TextBlock
        {
            Text = label,
            FontSize = 11,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(text, 1);
        row.Children.Add(text);
        button.Content = row;
        return button;
    }

    private TextBlock CreateOriginalSidebarEmptyText(string text) => new()
    {
        Text = text,
        Margin = new Thickness(8, 2, 8, 4),
        FontSize = 10,
        Opacity = 0.68,
        Foreground = OriginalSidebarBrush("XplorerTextMutedBrush", Color.FromArgb(0xff, 0x94, 0xa3, 0xb8)),
    };

    private void RefreshOriginalSidebarCollections()
    {
        if (_originalCollectionsContent is null) return;
        _originalCollectionsContent.Children.Clear();

        foreach (var collection in new[]
                 {
                     (Id: "large", Name: "Large Files", Glyph: "\uE7F1"),
                     (Id: "recent", Name: "Recent Files", Glyph: "\uE823"),
                     (Id: "images", Name: "Images", Glyph: "\uEB9F"),
                     (Id: "documents", Name: "Documents", Glyph: "\uE8A5"),
                     (Id: "code", Name: "Code Files", Glyph: "\uE943"),
                 })
        {
            var button = CreateOriginalSidebarPathButton(collection.Name, collection.Name, collection.Glyph);
            ToolTipService.SetToolTip(button, $"Filter current folder: {collection.Name}");
            if (string.Equals(_activeOriginalCollection, collection.Id, StringComparison.OrdinalIgnoreCase))
                button.Background = OriginalSidebarAccentBackground(0x24);
            button.Click += async (_, _) => await ToggleOriginalCollectionAsync(collection.Id, collection.Name);
            _originalCollectionsContent.Children.Add(button);
        }
    }

    private async Task ToggleOriginalCollectionAsync(string id, string name)
    {
        if (string.Equals(_activeOriginalCollection, id, StringComparison.OrdinalIgnoreCase))
        {
            _activeOriginalCollection = null;
            await NavigateAsync(CurrentPath, pushHistory: false);
            RefreshOriginalSidebarCollections();
            return;
        }

        await NavigateAsync(CurrentPath, pushHistory: false);
        _activeOriginalCollection = id;

        var filtered = Items.Where(item => id switch
        {
            "large" => !item.IsDirectory && (item.SizeBytes ?? 0) > 100L * 1024 * 1024,
            "recent" => item.LastWriteTimeUtc >= DateTime.UtcNow.AddDays(-7),
            "images" => !item.IsDirectory && HasExtension(item.FullPath, ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"),
            "documents" => !item.IsDirectory && HasExtension(item.FullPath, ".pdf", ".doc", ".docx", ".txt", ".md", ".xlsx", ".pptx"),
            "code" => !item.IsDirectory && HasExtension(item.FullPath, ".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".cpp", ".c", ".h"),
            _ => true,
        }).ToArray();

        Items.Clear();
        foreach (var item in filtered) Items.Add(item);
        ApplyViewMode(_settingsService.GetViewMode(CurrentPath));
        StatusText.Text = $"{Items.Count} items  •  Collection: {name}";
        RefreshOriginalSidebarCollections();
    }

    private static bool HasExtension(string path, params string[] extensions)
    {
        var extension = Path.GetExtension(path);
        return extensions.Any(candidate => string.Equals(extension, candidate, StringComparison.OrdinalIgnoreCase));
    }

    private void RefreshOriginalDriveListHeight()
    {
        if (!_originalSidebarInitialized) return;
        DriveList.Height = Math.Clamp(Drives.Count * 44d + 6, 44, 224);
        ScrollViewer.SetVerticalScrollBarVisibility(DriveList, ScrollBarVisibility.Disabled);
    }

    private void RefreshOriginalFileTreeRoots()
    {
        if (_originalFileTree is null) return;
        _originalTreePopulated.Clear();
        _originalFileTree.RootNodes.Clear();
        foreach (var drive in Drives)
        {
            var node = new TreeViewNode
            {
                Content = new OriginalTreeEntry(drive.DisplayName, drive.RootPath),
                HasUnrealizedChildren = true,
            };
            _originalFileTree.RootNodes.Add(node);
        }
    }

    private void OriginalFileTree_Expanding(TreeView sender, TreeViewExpandingEventArgs args)
    {
        if (args.Node.Content is not OriginalTreeEntry entry) return;
        PopulateOriginalFileTreeNode(args.Node, entry.Path);
    }

    private void PopulateOriginalFileTreeNode(TreeViewNode node, string path)
    {
        if (!_originalTreePopulated.Add(path)) return;
        node.Children.Clear();

        try
        {
            foreach (var directory in Directory.EnumerateDirectories(path)
                         .OrderBy(candidate => Path.GetFileName(candidate), StringComparer.CurrentCultureIgnoreCase)
                         .Take(256))
            {
                try
                {
                    var attributes = File.GetAttributes(directory);
                    if (!_settingsService.Current.ShowHiddenFiles && attributes.HasFlag(FileAttributes.Hidden))
                        continue;
                    var name = Path.GetFileName(directory);
                    node.Children.Add(new TreeViewNode
                    {
                        Content = new OriginalTreeEntry(string.IsNullOrWhiteSpace(name) ? directory : name, directory),
                        HasUnrealizedChildren = true,
                    });
                }
                catch
                {
                }
            }
        }
        catch
        {
        }

        node.HasUnrealizedChildren = false;
    }

    private async void OriginalFileTree_ItemInvoked(TreeView sender, TreeViewItemInvokedEventArgs args)
    {
        if (args.InvokedItem is OriginalTreeEntry entry && Directory.Exists(entry.Path))
            await NavigateAsync(entry.Path);
    }

    private void ShowOriginalSidebarExplorer()
    {
        if (_originalSidebarExplorerPane is null || _originalSidebarSearchPane is null) return;
        _originalSidebarExplorerPane.Visibility = Visibility.Visible;
        _originalSidebarSearchPane.Visibility = Visibility.Collapsed;
        ApplyOriginalSidebarTabState(searchActive: false);
    }

    private void ShowOriginalSidebarSearch(bool focus)
    {
        if (_originalSidebarExplorerPane is null || _originalSidebarSearchPane is null) return;
        _originalSidebarExplorerPane.Visibility = Visibility.Collapsed;
        _originalSidebarSearchPane.Visibility = Visibility.Visible;
        ApplyOriginalSidebarTabState(searchActive: true);
        RefreshOriginalSidebarSearchPresentation();
        RefreshOriginalSidebarSearchSummary();
        if (focus && _originalSidebarSearchBox is not null)
        {
            _originalSidebarSearchBox.Focus(FocusState.Programmatic);
            _originalSidebarSearchBox.SelectAll();
        }
    }

    private bool TryFocusOriginalSidebarSearch()
    {
        if (!_originalSidebarInitialized || _originalSidebarSearchBox is null) return false;
        ShowOriginalSidebarSearch(focus: true);
        return true;
    }

    private void ApplyOriginalSidebarTabState(bool searchActive)
    {
        if (_originalExplorerTabButton is null || _originalSearchTabButton is null) return;
        _originalExplorerTabButton.Background = searchActive
            ? new SolidColorBrush(Colors.Transparent)
            : OriginalSidebarAccentBackground(0x24);
        _originalSearchTabButton.Background = searchActive
            ? OriginalSidebarAccentBackground(0x24)
            : new SolidColorBrush(Colors.Transparent);
    }

    private void RefreshOriginalSidebarSearchPresentation()
    {
        if (_originalSidebarSearchBox is null) return;
        _originalSidebarSearchBox.PlaceholderText = _settingsService.Current.BackgroundIndexing
            ? "Search this folder recursively"
            : "Search this folder";
    }

    private void OriginalSidebarSearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncingOriginalSidebarSearch || _originalSidebarSearchBox is null) return;
        _syncingOriginalSidebarSearch = true;
        try
        {
            SearchBox.Text = _originalSidebarSearchBox.Text;
        }
        finally
        {
            _syncingOriginalSidebarSearch = false;
        }
        RefreshOriginalSidebarSearchSummary();
    }

    private void OriginalSearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncingOriginalSidebarSearch || _originalSidebarSearchBox is null) return;
        _syncingOriginalSidebarSearch = true;
        try
        {
            _originalSidebarSearchBox.Text = SearchBox.Text;
        }
        finally
        {
            _syncingOriginalSidebarSearch = false;
        }
        RefreshOriginalSidebarSearchSummary();
    }

    private void RefreshOriginalSidebarSearchSummary()
    {
        if (_originalSidebarSearchSummary is null) return;
        var query = _originalSidebarSearchBox?.Text.Trim() ?? string.Empty;
        _originalSidebarSearchSummary.Text = string.IsNullOrEmpty(query)
            ? $"Search in {GetTabHeader(CurrentPath)}"
            : $"{Items.Count} visible matches in {GetTabHeader(CurrentPath)}";
    }

    private Brush OriginalSidebarBrush(string key, Color fallback)
    {
        if (Root.Resources.TryGetValue(key, out var local) && local is Brush localBrush)
            return localBrush;
        if (Application.Current.Resources.TryGetValue(key, out var app) && app is Brush appBrush)
            return appBrush;
        return new SolidColorBrush(fallback);
    }

    private Brush OriginalSidebarAccentBackground(byte alpha)
    {
        var color = Root.Resources.TryGetValue("XplorerAccentBrush", out var resource) &&
                    resource is SolidColorBrush brush
            ? brush.Color
            : Color.FromArgb(0xff, 0x3b, 0x82, 0xf6);
        return new SolidColorBrush(Color.FromArgb(alpha, color.R, color.G, color.B));
    }

    private sealed record OriginalTreeEntry(string Name, string Path)
    {
        public override string ToString() => Name;
    }
}
