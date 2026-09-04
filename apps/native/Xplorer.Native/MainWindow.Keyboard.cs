using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.System;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private void InitializeKeyboardShortcuts()
    {
        InstallAccelerator(VirtualKey.L, VirtualKeyModifiers.Control, FocusAddressBar);
        InstallAccelerator(VirtualKey.T, VirtualKeyModifiers.Control, () => AddTab(CurrentPath, select: true));
        InstallAsyncAccelerator(VirtualKey.W, VirtualKeyModifiers.Control, CloseCurrentTabAsync);
        InstallAsyncAccelerator(VirtualKey.F5, VirtualKeyModifiers.None, () => NavigateAsync(CurrentPath, pushHistory: false));
        InstallAsyncAccelerator(VirtualKey.Left, VirtualKeyModifiers.Menu, NavigateBackFromKeyboardAsync);
        InstallAsyncAccelerator(VirtualKey.Right, VirtualKeyModifiers.Menu, NavigateForwardFromKeyboardAsync);
        InstallAsyncAccelerator(VirtualKey.Up, VirtualKeyModifiers.Menu, NavigateUpFromKeyboardAsync);
        InitializeNativeSearch();
        InitializeNativeDragDrop();
    }

    private void FocusAddressBar()
    {
        AddressBox.Focus(FocusState.Programmatic);
        AddressBox.SelectAll();
    }

    private async Task CloseCurrentTabAsync()
    {
        if (Tabs.TabItems.Count <= 1)
        {
            Close();
            return;
        }

        if (Tabs.SelectedItem is not TabViewItem closing) return;
        var oldIndex = Tabs.TabItems.IndexOf(closing);

        _suppressTabSelection = true;
        try
        {
            Tabs.TabItems.Remove(closing);
            Tabs.SelectedIndex = Math.Clamp(oldIndex - 1, 0, Tabs.TabItems.Count - 1);
        }
        finally
        {
            _suppressTabSelection = false;
        }

        if (ActiveTabState is not null)
            await NavigateAsync(ActiveTabState.CurrentPath, pushHistory: false);
    }

    private async Task NavigateBackFromKeyboardAsync()
    {
        var state = ActiveTabState;
        if (state is null || state.BackHistory.Count == 0) return;

        state.ForwardHistory.Push(state.CurrentPath);
        var target = state.BackHistory.Pop();
        await NavigateAsync(target, pushHistory: false);
    }

    private async Task NavigateForwardFromKeyboardAsync()
    {
        var state = ActiveTabState;
        if (state is null || state.ForwardHistory.Count == 0) return;

        state.BackHistory.Push(state.CurrentPath);
        var target = state.ForwardHistory.Pop();
        await NavigateAsync(target, pushHistory: false);
    }

    private async Task NavigateUpFromKeyboardAsync()
    {
        var parent = Directory.GetParent(CurrentPath)?.FullName;
        if (!string.IsNullOrWhiteSpace(parent))
            await NavigateAsync(parent);
    }
}
