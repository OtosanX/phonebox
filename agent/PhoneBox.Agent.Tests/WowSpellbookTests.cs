using System.Text;
using Xunit;

namespace PhoneBox.Agent.Tests;

public sealed class WowSpellbookTests
{
    [Fact]
    public void ReadsLearnedSpellsAndTheirReservedShortcuts()
    {
        var book = Assert.IsType<WowSpellList>(WowSpellbook.Parse(
            Export("MAGE\nMagier\nExample\n1\tBlinseln\n38\tFeuerball\n148\tEisrüstung\n2"), 16));
        Assert.Equal("Magier", book.ClassName);
        Assert.Equal(16, book.ProcessId);
        Assert.Equal(2, book.Unavailable);
        Assert.Equal(new WowSpell("MAGE:Blinseln", "Blinseln", "ctrl+shift+f1"), book.Spells[0]);
        Assert.Equal(new WowSpell("MAGE:Feuerball", "Feuerball", "ctrl+shift+alt+f1"), book.Spells[1]);
        Assert.Equal(new WowSpell("MAGE:Eisrüstung", "Eisrüstung", "alt+shift+z"), book.Spells[2]);
    }

    [Theory]
    [InlineData("ROGUE\nRogue\nExample\n1\tSap\n1\tSprint\n0")]
    [InlineData("ROGUE\nRogue\nExample\n149\tSap\n0")]
    [InlineData("ROGUE\nRogue\nExample\n1\tSap\n2\tSap\n0")]
    public void RejectsExportsThatCouldResolveToAnAmbiguousOrInvalidShortcut(string data)
    {
        Assert.Null(WowSpellbook.Parse(Export(data), 16));
    }

    [Fact]
    public void ReadsFormRequirementsActionIconsAndNonSpellActions()
    {
        var data = string.Join('\n', new[]
        {
            "DRUID", "Druid", "Example", "1\tspell\tDRUID:Cat Form\t132115\tCat Form\t\t1",
            "2\tspell\tDRUID:Faerie Fire\t136033\tFaerie Fire\t1,5\t0",
            "3\titem\tTRINKET:13\t134334\tUse trinket 1\t\t0", "bar\t1\t132140",
            "form\t1\tCat Form", "form\t5\tBear Form", "0",
        });
        var book = Assert.IsType<WowSpellList>(WowSpellbook.Parse(Export(data, 3), 16));
        Assert.Equal(1, book.Spells[0].OpensForm);
        Assert.Equal(new[] { 1, 5 }, book.Spells[1].Forms);
        Assert.Equal("item", book.Spells[2].Kind);
        Assert.Equal(134334, book.Spells[2].Icon);
        Assert.Equal(132140, book.BarIcons["1"]);
        Assert.Equal("Bear Form", book.Forms[5]);
    }

    private static string Export(string data, int version = 2) =>
        $"PhoneBoxSpellbookExport = \"PB{version}:" + Convert.ToHexString(Encoding.UTF8.GetBytes(data)) + "\"\r\n";

    [Theory]
    [InlineData(8, true, 0x26f03d)]
    [InlineData(12, false, 0xfa731a)]
    [InlineData(8, null, 0x000000)]
    public void StealthReaderRequiresTheMatchingCornerIndicator(int width, bool? expected, int stateColor)
    {
        Assert.Equal(expected, WowStealth.Decode(Pixel));

        int Pixel(int x, int y) => x < 4 || x >= 4 + width * 3 || y < 4 || y >= 4 + width
            ? 0 : ((x - 4) / width) switch { 0 => 0x0fd1f5, 1 => 0xc71ae3, _ => stateColor };
    }
}
