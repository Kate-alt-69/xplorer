using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.System;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private void InitializeKeyboardShortcuts()
    {
        // Navigation/window shortcuts remain global even while the address/search box is focused.
        // File-operation accelerators still use InstallAccelerator/InstallAsyncAccelerator, which
        // deliberately yield to text editing for Ctrl+C/X/V/Delete/F2.
        InstallGlobalAccelerator(VirtualKey.L, VirtualKeyModifiers.Control, FocusAddressBar);
        InstallGlobalAccelerator(VirtualKey.T, VirtualKeyModifiers.Control, () => AddTab(CurrentPath, select: true));
        InstallGlobalAsyncAccelerator(VirtualKey.W, VirtualKeyModifiers.Control, CloseCurrentTabAsync);
        InstallGlobalAsyncAccelerator(VirtualKey.F5, VirtualKeyModifiers.None, () => NavigateAsync(CurrentPath, pushHistory: false));
        InstallGlobalAsyncAccelerator(VirtualKey.Left, VirtualKeyModifiers.Menu, NavigateBackFromKeyboardAsync);
        InstallGlobalAsyncAccelerator(VirtualKey.Right, VirtualKeyModifiers.Menu, NavigateForwardFromKeyboardAsync);
        InstallGlobalAsyncAccelerator(VirtualKey.Up, VirtualKeyModifiers.Menu, NavigateUpFromKeyboardAsync);
        InitializeNativeSearch();
        InitializeNativeDragDrop();
    }

    private void InstallGlobalAccelerator(VirtualKey key, VirtualKeyModifiers modifiers, Action action)
    {
        var accelerator = new KeyboardAccelerator
        {
            Key = key,
            Modifiers = modifiers,
        };
        accelerator.Invoked += (_, args) =>
        {
            args.Handled = true;
            action();
        };
        Root.KeyboardAccelerators.Add(accelerator);
    }

    private void InstallGlobalAsyncAccelerator(
        VirtualKey key,
        VirtualKeyModifiers modifiers,
        Func<Task> action)
    {
        var accelerator = new KeyboardAccelerator
        {
            Key = key,
            Modifiers = modifiers,
        };
        accelerator.Invoked += async (_, args) =>
        {
            args.Handled = true;
            await action();
        };
        Root.KeyboardAccelerators.Add(accelerator);
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
